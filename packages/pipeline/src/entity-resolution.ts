// packages/pipeline/src/entity-resolution.ts
// Entity resolution: canonicalization, match suggestions, safe merge/unmerge.

import { normalizeName, type Logger } from "@permit-intel/shared";
import type { EntityQueries, EntityRow } from "@permit-intel/db";
import type { ExtractedEntity } from "@permit-intel/shared";

export type MatchTier = "exact" | "probable" | "possible";

export interface MatchSuggestion {
  existing_entity_id: string;
  tier: MatchTier;
  confidence: number;
  reasons: string[];
}

export interface ResolutionResult {
  entity_id: string;
  created: boolean;
  suggestion?: MatchSuggestion;
}

export class EntityResolutionService {
  constructor(
    private readonly db: EntityQueries,
    private readonly logger: Logger,
  ) {}

  /**
   * Resolve an extracted entity against the entity graph.
   * - Exact match: auto-links (returns existing entity ID).
   * - Probable match: returns suggestion (requires operator approval).
   * - No match: creates new entity.
   */
  async resolve(
    extracted: ExtractedEntity,
    sourceEvidenceId: string,
  ): Promise<ResolutionResult> {
    const log = this.logger.child({ stage_name: "entity_resolution" });
    const aliasNorm = normalizeName(extracted.name_norm || extracted.name_raw);

    // ---- Check strong identifiers first (exact match) ----
    for (const ident of extracted.identifiers ?? []) {
      if (!ident.value) continue;
      const match = await this.db.findByIdentifier(ident.type, ident.value);
      if (match) {
        log.info("entity:exact_match_by_identifier", {
          entity_id: match.id,
          id_type: ident.type,
          id_value: ident.value,
        });
        await this.addAliasIfNew(match.id, extracted, sourceEvidenceId);
        return { entity_id: match.id, created: false };
      }
    }

    // ---- Check by normalized name ----
    const byName = await this.db.findByAliasNorm(aliasNorm);

    if (byName.length === 1) {
      const match = byName[0]!;
      // Check address overlap for confidence
      const addrMatch =
        extracted.address_norm &&
        (await this.hasAddressOverlap(match.id, extracted.address_norm));

      if (addrMatch) {
        // Probable -> exact if address also matches
        log.info("entity:exact_match_by_name_address", { entity_id: match.id });
        await this.addAliasIfNew(match.id, extracted, sourceEvidenceId);
        return { entity_id: match.id, created: false };
      } else {
        // Probable match — return suggestion, do NOT auto-merge
        const suggestion: MatchSuggestion = {
          existing_entity_id: match.id,
          tier: "probable",
          confidence: 0.7,
          reasons: [`alias_norm_match:${aliasNorm}`],
        };
        const newEntity = await this.createNewEntity(extracted, sourceEvidenceId);
        log.info("entity:probable_suggestion", {
          new_entity_id: newEntity.id,
          suggested_match: match.id,
        });
        return {
          entity_id: newEntity.id,
          created: true,
          suggestion,
        };
      }
    } else if (byName.length > 1) {
      // Possible match — store as new, surface suggestion for operator
      const suggestion: MatchSuggestion = {
        existing_entity_id: byName[0]!.id,
        tier: "possible",
        confidence: 0.4,
        reasons: [`alias_norm_match:${aliasNorm}`, `multiple_matches:${byName.length}`],
      };
      const newEntity = await this.createNewEntity(extracted, sourceEvidenceId);
      return { entity_id: newEntity.id, created: true, suggestion };
    }

    // ---- No match: create new ----
    const newEntity = await this.createNewEntity(extracted, sourceEvidenceId);
    log.info("entity:created", { entity_id: newEntity.id });
    return { entity_id: newEntity.id, created: true };
  }

  private async createNewEntity(
    extracted: ExtractedEntity,
    sourceEvidenceId: string,
  ): Promise<EntityRow> {
    const entityType =
      extracted.role === "owner" || extracted.role === "applicant"
        ? "org"
        : extracted.role === "contractor" || extracted.role === "architect" || extracted.role === "engineer"
          ? "org"
          : "person";

    const entity = await this.db.create({
      entity_type: entityType,
      canonical_name: extracted.name_norm || extracted.name_raw,
    });

    // Add primary alias
    await this.db.addAlias({
      entity_id: entity.id,
      alias: extracted.name_raw,
      alias_norm: normalizeName(extracted.name_raw),
      source_evidence_id: sourceEvidenceId,
      address_norm: extracted.address_norm || undefined,
    });

    // Add identifiers
    for (const ident of extracted.identifiers ?? []) {
      if (ident.value) {
        await this.db.addIdentifier({
          entity_id: entity.id,
          id_type: ident.type,
          id_value: ident.value,
          source_evidence_id: sourceEvidenceId,
        });
      }
    }

    return entity;
  }

  private async addAliasIfNew(
    entityId: string,
    extracted: ExtractedEntity,
    sourceEvidenceId: string,
  ): Promise<void> {
    const aliasNorm = normalizeName(extracted.name_raw);
    const existing = await this.db.findByAliasNorm(aliasNorm);
    const alreadyLinked = existing.some((e) => e.id === entityId);
    if (!alreadyLinked) {
      await this.db.addAlias({
        entity_id: entityId,
        alias: extracted.name_raw,
        alias_norm: aliasNorm,
        source_evidence_id: sourceEvidenceId,
        address_norm: extracted.address_norm || undefined,
      });
    }
  }

  private async hasAddressOverlap(
    entityId: string,
    addressNorm: string,
  ): Promise<boolean> {
    const aliases = await this.db.getAliases(entityId);
    return aliases.some(
      (a) => a.address_norm && a.address_norm === addressNorm,
    );
  }

  /**
   * Perform operator-approved merge.
   * Builds diff for unmerge support.
   */
  async executeMerge(
    winnerEntityId: string,
    mergedEntityId: string,
    rule: string,
    confidence: number,
  ): Promise<string> {
    // Capture before state for diff
    const mergedAliases = await this.db.getAliases(mergedEntityId);
    const mergedIdents = await this.db.getIdentifiers(mergedEntityId);

    const diff = {
      moved_alias_ids: mergedAliases.map((a) => a.id),
      moved_identifier_ids: mergedIdents.map((i) => i.id),
      merged_entity_snapshot: {
        id: mergedEntityId,
        aliases: mergedAliases,
        identifiers: mergedIdents,
      },
    };

    const ledgerId = await this.db.merge({
      winnerEntityId,
      mergedEntityId,
      rule,
      confidence,
      operatorDecision: "approved",
      diffJson: JSON.stringify(diff),
    });

    this.logger.info("entity:merged", {
      entity_id: winnerEntityId,
      merged_entity_id: mergedEntityId,
      ledger_id: ledgerId,
    });

    return ledgerId;
  }

  async executeUnmerge(mergeLedgerId: string, note?: string): Promise<void> {
    await this.db.unmerge(mergeLedgerId, note);
    this.logger.info("entity:unmerged", { merge_ledger_id: mergeLedgerId });
  }
}
