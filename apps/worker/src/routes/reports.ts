import type { Db } from '@permit-intel/db/src/client.js';
import {
  createReport,
  getReportById,
  listReports,
  createReportVersion,
  updateReportStatus,
  getReportVersion,
} from '@permit-intel/db/src/queries/reports.js';
import { getPermitById } from '@permit-intel/db/src/queries/permits.js';
import { getStageAttemptsByVersion } from '@permit-intel/db/src/queries/stages.js';
import type { Env } from '../index.js';

export async function handleReports(req: Request, db: Db, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const reportId = segments[2];
  const sub = segments[3]; // 'versions', 'run'

  if (req.method === 'GET' && !reportId) {
    const reports = await listReports(db);
    return json({ reports });
  }

  if (req.method === 'GET' && reportId && !sub) {
    const report = await getReportById(db, reportId);
    if (!report) return json({ error: 'Not found' }, 404);
    return json({ report });
  }

  if (req.method === 'POST' && !reportId) {
    // Create report for a permit
    const body = await req.json() as { permit_id: string };
    if (!body.permit_id) return json({ error: 'permit_id required' }, 400);
    const permit = await getPermitById(db, body.permit_id);
    if (!permit) return json({ error: 'Permit not found' }, 404);

    const report = await createReport(db, body.permit_id);
    return json({ report }, 201);
  }

  if (req.method === 'POST' && reportId && sub === 'run') {
    // Create a new report version and queue it
    const report = await getReportById(db, reportId);
    if (!report) return json({ error: 'Not found' }, 404);

    const permit = await getPermitById(db, report.permit_id);
    if (!permit) return json({ error: 'Permit not found' }, 404);

    // Create immutable snapshot
    const snapshot = { permit, run_at: new Date().toISOString() };
    const version = await createReportVersion(db, reportId, snapshot);

    // Update report status
    await updateReportStatus(db, reportId, 'queued', version.id);

    // Queue pipeline job
    if (env.PIPELINE_QUEUE) {
      await env.PIPELINE_QUEUE.send({
        type: 'run_pipeline',
        report_id: reportId,
        report_version_id: version.id,
      });
    }

    return json({ report_version: version }, 201);
  }

  if (req.method === 'GET' && reportId && sub === 'stages') {
    const report = await getReportById(db, reportId);
    if (!report || !report.active_version_id) return json({ stages: [] });
    const stages = await getStageAttemptsByVersion(db, report.active_version_id);
    return json({ stages });
  }

  return json({ error: 'Not found' }, 404);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
