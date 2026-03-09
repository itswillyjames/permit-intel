// packages/pipeline/src/orchestrator.ts
// Pipeline orchestrator: coordinates stage execution for a report version.
// Handles DAG ordering, gating, partial failure semantics.

import {
  assertReportTransition,
  assertStageTransition,
  now,
  hashObject,
  stageIdempotencyKey,
  type Logger,
} from "@permit-intel/shared";
import type {
  ReportQueries,
  PermitQueries,
  EvidenceQueries,
  EntityQueries,
} from "@permit-intel/db";
import type { LLMClient } from "./providers/llm-client.js";
import {
  PermitParseRunner,
  EntityExtractRunner,
  ContactDiscoveryRunner,
  DossierComposeRunner,
} from "./stages/runners.js";
import { EntityResolutionService } from "./entity-resolution.js";
import type { PermitParseOutput, EntityExtractOutput } from "@permit-intel/shared";

export interface OrchestratorDeps {
  reportDb: ReportQueries;
  permitDb: PermitQueries;
  evidenceDb: EvidenceQueries;
  entityDb: EntityQueries;
  llmClient: LLMClient;
  logger: Logger;
  promptVersion: string;
}

const STAGE_ORDER = [
  "permit_parse",
  "entity_extract",
  "contact_discovery",
  "dossier_compose",
] as const;

type StageName = (typeof STAGE_ORDER)[number];

const REQUIRED_STAGES: Set<StageName> = new Set([
  "permit_parse",
  "entity_extract",
  "dossier_compose",
]);

export class PipelineOrchestrator {
  private readonly resolution: EntityResolutionService;

  constructor(private readonly deps: OrchestratorDeps) {
    this.resolution = new EntityResolutionService(
      deps.entityDb,
      deps.logger,
    );
  }

  /**
   * Run the full pipeline for a report version.
   * Returns final report status.
   */
  async runReportVersion(reportVersionId: string): Promise<void> {
    const log = this.deps.logger.child({ report_version_id: reportVersionId });

    const version = await this.deps.reportDb.findVersionById(reportVersionId);
    if (!version) throw new Error(`ReportVersion ${reportVersionId} not found`);

    const report = await this.deps.reportDb.findReportById(version.report_id);
    if (!report) throw new Error(`Report ${version.report_id} not found`);

    const snapshot = JSON.parse(version.snapshot_json) as {
      permit: {
        id: string;
        city: string;
        address_raw: string;
        address_norm: string;
        work_type: string;
        description_raw: string;
        valuation: number | null;
        applicant_raw: string;
        contractor_raw: string;
        owner_raw: string;
        filed_date: string;
        issued_date: string;
      };
    };

    // Transition report to running
    await this.deps.reportDb.updateVersionStatus(reportVersionId, "running");
    await this.deps.reportDb.appendReportEvent(reportVersionId, "report:started", {
      report_version_id: reportVersionId,
    });

    const stageResults: Record<string, unknown> = {};
    const stageStatuses: Record<string, "succeeded" | "failed_terminal" | "skipped"> = {};

    // ---- Run stages in order ----
    for (const stageName of STAGE_ORDER) {
      log.info(`stage:dispatch`, { stage_name: stageName });

      try {
        const output = await this.runStage(
          stageName,
          reportVersionId,
          snapshot,
          stageResults,
          log,
        );
        stageResults[stageName] = output;
        stageStatuses[stageName] = "succeeded";
      } catch (err) {
        const isRequired = REQUIRED_STAGES.has(stageName);
        stageStatuses[stageName] = "failed_terminal";

        if (isRequired) {
          log.error(`required_stage:failed`, err, { stage_name: stageName });
          await this.deps.reportDb.updateVersionStatus(reportVersionId, "failed");
          await this.deps.reportDb.updateReportStatus(
            version.report_id,
            "failed",
          );
          await this.deps.reportDb.appendReportEvent(
            reportVersionId,
            "report:failed",
            { stage_name: stageName, error: (err as Error).message },
          );
          return;
        } else {
          log.warn(`optional_stage:failed`, { stage_name: stageName });
        }
      }
    }

    // ---- Determine final status ----
    const hasTerminalFailure = Object.values(stageStatuses).some(
      (s) => s === "failed_terminal",
    );
    const finalStatus = hasTerminalFailure ? "partial" : "completed";

    await this.deps.reportDb.updateVersionStatus(reportVersionId, finalStatus);
    await this.deps.reportDb.updateReportStatus(
      version.report_id,
      finalStatus,
      reportVersionId,
    );
    await this.deps.reportDb.appendReportEvent(
      reportVersionId,
      `report:${finalStatus}`,
      { stages: stageStatuses },
    );

    log.info("pipeline:done", { status: finalStatus });
  }

  private async runStage(
    stageName: StageName,
    reportVersionId: string,
    snapshot: { permit: Record<string, unknown> & { id: string; city: string; address_raw: string; address_norm: string; work_type: string; description_raw: string; valuation: number | null; applicant_raw: string; contractor_raw: string; owner_raw: string; filed_date: string; issued_date: string } },
    priorResults: Record<string, unknown>,
    log: Logger,
  ): Promise<unknown> {
    const p = snapshot.permit;
    const ctx = {
      reportVersionId,
      db: this.deps.reportDb,
      llmClient: this.deps.llmClient,
      logger: log,
      promptVersion: this.deps.promptVersion,
    };

    switch (stageName) {
      case "permit_parse": {
        const runner = new PermitParseRunner();
        const result = await runner.run(ctx, {
          city: p.city,
          address: p.address_norm || p.address_raw,
          work_type: p.work_type,
          description: p.description_raw,
          valuation: p.valuation,
          applicant: p.applicant_raw,
          contractor: p.contractor_raw,
          filed_date: p.filed_date,
        });
        return result.output;
      }

      case "entity_extract": {
        const parseOutput = priorResults["permit_parse"] as PermitParseOutput | undefined;
        const runner = new EntityExtractRunner();
        const result = await runner.run(ctx, {
          permit_id: p.id,
          address: p.address_norm || p.address_raw,
          city: p.city,
          description: p.description_raw,
          applicant_raw: p.applicant_raw,
          contractor_raw: p.contractor_raw,
          owner_raw: p.owner_raw,
          scope_summary: parseOutput?.permit.scope_summary ?? "",
          evidence_ids: [],
        });

        // Resolve entities
        for (const extracted of result.output.entities) {
          const permitEvidenceId = await this.ensurePermitEvidence(p.id, reportVersionId);
          const resolution = await this.resolution.resolve(extracted, permitEvidenceId);
          log.info("entity:resolved", {
            entity_id: resolution.entity_id,
            created: resolution.created,
            tier: resolution.suggestion?.tier,
          });
        }

        return result.output;
      }

      case "contact_discovery": {
        const entityOutput = priorResults["entity_extract"] as EntityExtractOutput | undefined;
        if (!entityOutput?.entities.length) {
          log.info("stage:skipped:no_entities", { stage_name: stageName });
          return { contacts: [] };
        }

        const runner = new ContactDiscoveryRunner();
        const result = await runner.run(ctx, {
          entities: entityOutput.entities.map((e) => ({
            entity_id: "",
            canonical_name: e.name_norm,
            role: e.role,
            address: e.address_norm,
          })),
          evidence_ids: [],
          osint_text: "",
        });
        return result.output;
      }

      case "dossier_compose": {
        const parseOutput = priorResults["permit_parse"] as PermitParseOutput | undefined;
        const entityOutput = priorResults["entity_extract"] as EntityExtractOutput | undefined;

        const runner = new DossierComposeRunner();
        const evidence = await this.deps.evidenceDb.getEvidenceForLink(
          "report_version",
          reportVersionId,
        );

        const result = await runner.run(ctx, {
          permit: {
            id: p.id,
            address: p.address_norm || p.address_raw,
            city: p.city,
            work_type: p.work_type,
            description: p.description_raw,
            valuation: p.valuation,
            filed_date: p.filed_date,
            issued_date: p.issued_date,
            scope_summary: parseOutput?.permit.scope_summary ?? "",
          },
          entities: entityOutput?.entities.map((e) => ({
            role: e.role,
            canonical_name: e.name_norm,
            confidence: e.confidence,
            contacts: [],
          })) ?? [],
          evidence_index: evidence.map((ev) => ({
            evidence_id: ev.id,
            title: ev.title ?? ev.source,
            source: ev.source,
            retrieved_at: ev.retrieved_at,
          })),
        });
        return result.output;
      }

      default:
        throw new Error(`Unknown stage: ${stageName}`);
    }
  }

  private async ensurePermitEvidence(
    permitId: string,
    reportVersionId: string,
  ): Promise<string> {
    const { hashObject } = await import("@permit-intel/shared");
    const hash = await hashObject({ permit_id: permitId, type: "permit_record" });
    const ev = await this.deps.evidenceDb.createItem({
      type: "registry",
      source: `permit:${permitId}`,
      title: `Permit record ${permitId}`,
      retrieved_at: now(),
      hash,
    });
    await this.deps.evidenceDb.linkEvidence(ev.id, "report_version", reportVersionId);
    await this.deps.evidenceDb.linkEvidence(ev.id, "permit", permitId);
    return ev.id;
  }
}
