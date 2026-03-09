/**
 * Pipeline orchestrator.
 * Coordinates the stage DAG for a single report version.
 * Handles stage dependencies, gating, partial failures.
 */
import type { Db } from '@permit-intel/db/src/client.js';
import {
  getReportVersion,
  updateReportVersionStatus,
  appendReportEvent,
} from '@permit-intel/db/src/queries/reports.js';
import {
  updateReportStatus,
} from '@permit-intel/db/src/queries/reports.js';
import { getSucceededOutput } from '@permit-intel/db/src/queries/stages.js';
import type { LLMClient } from '../providers/client.js';
import { PermitParseStage } from '../stages/permit-parse.js';
import { EntityExtractStage } from '../stages/entity-extract.js';
import { DossierComposeStage } from '../stages/dossier-compose.js';
import { sha256 } from '@permit-intel/shared/src/utils/index.js';
import { logger } from '@permit-intel/shared/src/utils/index.js';
import type { StageContext } from '../stages/runner.js';

export interface OrchestratorOptions {
  db: Db;
  llm: LLMClient;
  reportId: string;
  reportVersionId: string;
}

export interface StageDefinition {
  name: string;
  required: boolean;
  dependsOn: string[];
}

export const STAGE_DAG: StageDefinition[] = [
  { name: 'permit_parse', required: true, dependsOn: [] },
  { name: 'entity_extract', required: true, dependsOn: ['permit_parse'] },
  { name: 'dossier_compose', required: true, dependsOn: ['permit_parse', 'entity_extract'] },
];

export async function runPipeline(opts: OrchestratorOptions): Promise<void> {
  const { db, llm, reportId, reportVersionId } = opts;
  const logCtx = { report_id: reportId, report_version_id: reportVersionId };

  logger.info('Pipeline started', logCtx);

  const version = await getReportVersion(db, reportVersionId);
  if (!version) throw new Error(`Report version ${reportVersionId} not found`);

  const snapshot = JSON.parse(version.snapshot_json) as Record<string, unknown>;
  const permit = snapshot['permit'] as {
    id: string; city: string; work_type: string | null; description_raw: string | null;
    address_norm: string | null; valuation: number | null; filed_date: string | null;
    issued_date: string | null; applicant_raw: string | null; contractor_raw: string | null;
    owner_raw: string | null;
  };

  await updateReportVersionStatus(db, reportVersionId, 'running');
  await updateReportStatus(db, reportId, 'running');
  await appendReportEvent(db, reportVersionId, 'pipeline.started');

  const succeeded = new Set<string>();
  const failed = new Set<string>();

  for (const stageDef of STAGE_DAG) {
    // Check dependencies
    const depsOk = stageDef.dependsOn.every((dep) => succeeded.has(dep));
    if (!depsOk) {
      if (stageDef.required) {
        logger.warn('Required stage skipped due to failed dependency', { ...logCtx, stage: stageDef.name });
        failed.add(stageDef.name);
        continue;
      }
      continue;
    }

    const idempotencyKey = sha256(`${reportVersionId}:${stageDef.name}:v1`);
    const ctx: StageContext = {
      db, llm, reportVersionId,
      idempotencyKey,
      stageName: stageDef.name,
    };

    try {
      await runStage(ctx, stageDef.name, permit, succeeded, db, reportVersionId);
      succeeded.add(stageDef.name);
    } catch (err) {
      logger.error('Stage failed in pipeline', { ...logCtx, stage: stageDef.name, err: String(err) });
      failed.add(stageDef.name);
      if (stageDef.required) {
        break; // stop pipeline on required stage failure
      }
    }
  }

  // Determine final status
  const requiredFailed = STAGE_DAG.filter((s) => s.required && failed.has(s.name));
  const finalStatus = requiredFailed.length > 0 ? 'failed' :
    failed.size > 0 ? 'partial' : 'completed';

  await updateReportVersionStatus(db, reportVersionId, finalStatus);
  await updateReportStatus(db, reportId, finalStatus, reportVersionId);
  await appendReportEvent(db, reportVersionId, `pipeline.${finalStatus}`, {
    succeeded: [...succeeded],
    failed: [...failed],
  });

  logger.info('Pipeline complete', { ...logCtx, status: finalStatus });
}

async function runStage(
  ctx: StageContext,
  stageName: string,
  permit: Record<string, unknown>,
  succeeded: Set<string>,
  db: Db,
  reportVersionId: string,
): Promise<void> {
  switch (stageName) {
    case 'permit_parse': {
      const runner = new PermitParseStage();
      await runner.run(ctx, {
        city: String(permit['city'] ?? ''),
        work_type: (permit['work_type'] as string) ?? null,
        description_raw: (permit['description_raw'] as string) ?? null,
        address_norm: (permit['address_norm'] as string) ?? null,
        valuation: (permit['valuation'] as number) ?? null,
      });
      break;
    }

    case 'entity_extract': {
      const parseOutput = await getSucceededOutput(db, reportVersionId, 'permit_parse');
      if (!parseOutput) throw new Error('entity_extract: permit_parse output missing');
      const runner = new EntityExtractStage();
      await runner.run(ctx, {
        permit: {
          city: String(permit['city'] ?? ''),
          address_norm: (permit['address_norm'] as string) ?? null,
          work_type: (permit['work_type'] as string) ?? null,
          description_raw: (permit['description_raw'] as string) ?? null,
          applicant_raw: (permit['applicant_raw'] as string) ?? null,
          contractor_raw: (permit['contractor_raw'] as string) ?? null,
          owner_raw: (permit['owner_raw'] as string) ?? null,
        },
        evidenceIds: [],
      });
      break;
    }

    case 'dossier_compose': {
      const parseOut = await getSucceededOutput(db, reportVersionId, 'permit_parse');
      const entityOut = await getSucceededOutput(db, reportVersionId, 'entity_extract');
      if (!parseOut || !entityOut) throw new Error('dossier_compose: upstream outputs missing');

      const runner = new DossierComposeStage();
      await runner.run(ctx, {
        permit: {
          address_norm: (permit['address_norm'] as string) ?? null,
          city: String(permit['city'] ?? ''),
          work_type: (permit['work_type'] as string) ?? null,
          valuation: (permit['valuation'] as number) ?? null,
          filed_date: (permit['filed_date'] as string) ?? null,
          issued_date: (permit['issued_date'] as string) ?? null,
          description_raw: (permit['description_raw'] as string) ?? null,
        },
        parseOutput: JSON.parse(parseOut.output_json),
        entityOutput: JSON.parse(entityOut.output_json),
        contactOutput: { contacts: [] },
        evidenceIndex: [],
      });
      break;
    }

    default:
      throw new Error(`Unknown stage: ${stageName}`);
  }
}
