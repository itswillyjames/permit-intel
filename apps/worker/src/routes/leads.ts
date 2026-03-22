import type { Db } from '@permit-intel/db/src/client.js';
import { getPermitById, listPermitSources, type PermitRow } from '@permit-intel/db/src/queries/permits.js';
import {
  createLeadAssetExport,
  getLeadAssetById,
  listLeadAssetsByPermit,
  type LeadAssetType,
} from '@permit-intel/db/src/queries/exports.js';
import { getEvidenceForLink, insertOrGetEvidence, linkEvidence } from '@permit-intel/db/src/queries/evidence.js';
import { createReport, createReportVersion, getReportByPermitId, updateReportStatus } from '@permit-intel/db/src/queries/reports.js';
import type { Env } from '../index.js';

interface AssetDef {
  assetType: LeadAssetType;
  format: 'md' | 'json' | 'csv';
  contentType: string;
  fileName: string;
  body: string;
  renderHtml?: string;
}

export async function handleLeads(req: Request, db: Db, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const permitId = segments[2];
  const node = segments[3];
  const sub = segments[4];
  const tail = segments[5];

  if (!permitId) return json({ error: 'permit_id required' }, 400);

  if (req.method === 'GET' && node === 'ping') {
    const permit = await getPermitById(db, permitId);
    if (!permit) return json({ error: 'Permit not found' }, 404);
    return json({ ok: true, permit_id: permitId });
  }

  if (req.method === 'POST' && node === 'assets' && sub === 'generate') {
    if (!env.EXPORTS_BUCKET) return json({ error: 'EXPORTS_BUCKET not configured' }, 500);
    const permit = await getPermitById(db, permitId);
    if (!permit) return json({ error: 'Permit not found' }, 404);

    const permitSources = await listPermitSources(db, permitId);
    const reportVersionId = await ensureReportVersionForLeadAssets(db, permit);

    await ensurePermitEvidence(db, permitId, permit as unknown as Record<string, unknown>, permitSources);
    const assets = composeAssets(permit, permitSources);

    const persisted = [] as Array<Record<string, unknown>>;
    for (const asset of assets) {
      const datePrefix = new Date().toISOString().slice(0, 10);
      const key = `leads/${permitId}/${datePrefix}/${asset.fileName}`;
      await env.EXPORTS_BUCKET.put(key, asset.body, {
        httpMetadata: { contentType: asset.contentType },
      });

      let htmlStorageRef: string | undefined;
      if (asset.assetType === 'lead_dossier_full' && asset.renderHtml) {
        const htmlKey = `leads/${permitId}/${datePrefix}/Dossier_Full_${permit.source_permit_id}.html`;
        await env.EXPORTS_BUCKET.put(htmlKey, asset.renderHtml, {
          httpMetadata: { contentType: 'text/html; charset=utf-8' },
        });
        htmlStorageRef = `r2:${htmlKey}`;
      }

      const row = await createLeadAssetExport(db, {
        reportVersionId,
        permitId,
        assetType: asset.assetType,
        format: asset.format,
        contentType: asset.contentType,
        fileName: asset.fileName,
        storageRef: `r2:${key}`,
        htmlStorageRef,
        metadata: { generated_at: new Date().toISOString(), permit_source_count: permitSources.length },
      });

      persisted.push(toAssetApi(url, row));
    }

    return json({ permit_id: permitId, assets: persisted }, 201);
  }

  if (req.method === 'GET' && node === 'assets' && !sub) {
    const assets = await listLeadAssetsByPermit(db, permitId);
    return json({ permit_id: permitId, assets: assets.map((a) => toAssetApi(url, a)) });
  }

  if (req.method === 'GET' && node === 'assets' && sub && tail === 'content') {
    if (!env.EXPORTS_BUCKET) return json({ error: 'EXPORTS_BUCKET not configured' }, 500);

    const asset = await getLeadAssetById(db, sub);
    if (!asset || asset.permit_id !== permitId || !asset.storage_ref?.startsWith('r2:')) {
      return json({ error: 'Asset not found' }, 404);
    }

    const key = asset.storage_ref.replace(/^r2:/, '');
    const obj = await env.EXPORTS_BUCKET.get(key);
    if (!obj) return json({ error: 'Asset content missing' }, 404);

    return new Response(await obj.text(), {
      headers: { 'content-type': asset.content_type ?? 'text/plain; charset=utf-8' },
    });
  }

  if (req.method === 'GET' && node === 'evidence') {
    const permit = await getPermitById(db, permitId);
    if (!permit) return json({ error: 'Permit not found' }, 404);

    const permitSources = await listPermitSources(db, permitId);
    await ensurePermitEvidence(db, permitId, permit as unknown as Record<string, unknown>, permitSources);

    const evidence = await getEvidenceForLink(db, 'permit', permitId);
    return json({
      permit_id: permitId,
      evidence: evidence.map((item) => ({
        id: item.id,
        title: item.title,
        source: item.source,
        retrieved_at: item.retrieved_at,
        mime_type: item.mime_type,
      })),
    });
  }

  return json({ error: 'Not found' }, 404);
}

async function ensureReportVersionForLeadAssets(db: Db, permit: PermitRow): Promise<string> {
  const report = (await getReportByPermitId(db, permit.id)) ?? (await createReport(db, permit.id));
  const snapshot = {
    permit,
    run_at: new Date().toISOString(),
    run_type: 'lead_assets',
  };
  const version = await createReportVersion(db, report.id, snapshot);
  await updateReportStatus(db, report.id, 'partial', version.id);
  return version.id;
}

async function ensurePermitEvidence(
  db: Db,
  permitId: string,
  permit: Record<string, unknown>,
  sources: Array<{ source_name: string; source_url: string | null }>,
) {
  const permitPayload = JSON.stringify({ permit_id: permitId, permit });
  const permitHash = await sha256Hex(permitPayload);

  const permitEvidence = await insertOrGetEvidence(db, {
    type: 'note',
    source: `permit:${permitId}`,
    title: `Permit record ${permitId}`,
    hash: permitHash,
    mimeType: 'application/json',
    bytesLen: permitPayload.length,
  });
  await linkEvidence(db, permitEvidence.item.id, 'permit', permitId);

  for (const src of sources.slice(0, 5)) {
    const raw = JSON.stringify(src);
    const hash = await sha256Hex(`${permitId}:${src.source_name}:${src.source_url ?? ''}`);
    const item = await insertOrGetEvidence(db, {
      type: 'web_page',
      source: src.source_url || `source:${src.source_name}`,
      title: `Permit source: ${src.source_name}`,
      hash,
      mimeType: 'application/json',
      bytesLen: raw.length,
    });
    await linkEvidence(db, item.item.id, 'permit', permitId);
  }
}

function toAssetApi(url: URL, row: any) {
  return {
    asset_type: row.asset_type,
    export_id: row.id,
    status: row.status,
    content_type: row.content_type,
    file_name: row.file_name,
    download_url: `${url.origin}/api/leads/${row.permit_id}/assets/${row.id}/content`,
    preview_url:
      row.asset_type === 'lead_dossier_full' && row.html_storage_ref
        ? `${url.origin}/api/exports/${row.id}/html`
        : `${url.origin}/api/leads/${row.permit_id}/assets/${row.id}/content`,
  };
}

function composeAssets(permit: PermitRow, permitSources: Array<{ source_name: string; source_url: string | null }>): AssetDef[] {
  const address = permit.address_norm || permit.address_raw || 'Unknown address';
  const applicant = permit.applicant_raw || permit.owner_raw || 'Unknown';
  const valuation = permit.valuation ? `$${Number(permit.valuation).toLocaleString()}` : 'Not listed';
  const filed = permit.filed_date || 'Unknown';
  const issued = permit.issued_date || 'Unknown';
  const workType = permit.work_type || 'General improvement';
  const desc = permit.description_raw || 'No source description available.';

  const evidenceMd = ['- Permit record evidence (internal D1 permit row)', ...permitSources.map((s) => `- ${s.source_name}: ${s.source_url || 'source url unavailable'}`)].join('\n');

  const dossierMd = `# Lead Dossier: ${address}\n\n## Executive Summary\n- Location: ${address}\n- Permit ID: ${permit.source_permit_id}\n- City: ${permit.city}\n- Valuation Signal: ${valuation}\n- Intent Signal: ${workType}\n\n## Project Details\n- Filed Date: ${filed}\n- Issued Date: ${issued}\n- Status: ${permit.status}\n- Description: ${desc}\n\n## Key Entities\n- Applicant: ${applicant}\n- Contractor: ${permit.contractor_raw || ''}\n- Owner: ${permit.owner_raw || ''}\n\n## Recommended Next Steps\n1. Confirm active decision-maker and procurement timeline.\n2. Qualify project phase and bid package sequencing.\n3. Share comparable value-add scope and expected budget bands.\n\n## Resale Playbook\n### Positioning\nTarget this lead as a ${workType.toLowerCase()} opportunity with verified municipal record context.\n\n### Buyer Targets\n- Local GC and trade partners specializing in ${permit.city} renovation/addition projects.\n- Material/showroom partners aligned to valuation band ${valuation}.\n\n### Pricing Logic\n- Anchor by reported permit valuation and execution urgency inferred from filed/issued cadence.\n\n### Objections & Rebuttals\n- Objection: \"Timing uncertain\" -> Rebuttal: filed/issued dates indicate active path.\n- Objection: \"Need verified source\" -> Rebuttal: municipal permit source linked in evidence index.\n\n## Evidence Index\n${evidenceMd}\n`;

  const dossierHtml = `<html><body><pre>${escapeHtml(dossierMd)}</pre></body></html>`;

  const teaserMd = `# Teaser: ${address}\n\n## Key Hook\n${workType} project with valuation signal of ${valuation}.\n\n## Value\nPermit is already filed${issued !== 'Unknown' ? ` and issued (${issued})` : ''}, making this a near-term sales motion.\n\n## Who to Contact\nPrimary contact on file: ${applicant}.\n\n## Next Step CTA\nReply with your trade category and service area to receive the full Lead Dossier and pricing strategy.\n`;

  const playbook = {
    positioning: `Municipal-record verified ${workType} opportunity at ${address}.`,
    buyer_targets: [
      { target: 'General Contractors', why_fit: 'Need permit-ready leads with valuation signals.' },
      { target: 'Specialty Trades', why_fit: 'Scope suggests follow-on trade packages.' },
    ],
    pricing_logic: `Use ${valuation} as initial anchor, adjusted by scope complexity and urgency.`,
    objections_rebuttals: [
      { objection: 'Source credibility', rebuttal: 'Lead tied to municipal permit record and linked source.' },
      { objection: 'Execution timing unclear', rebuttal: 'Filed/issued timeline indicates active opportunity.' },
    ],
    signals: {
      valuation,
      intent: workType,
      timeline: { filed_date: filed, issued_date: issued },
    },
  };

  const csv = [
    'company/person,role/category,why-fit,confidence,location,phone,email,linkedin,notes',
    `"${applicant}","Applicant/Owner","Named on permit record","0.65","${permit.city}","","","","Primary permit-associated contact"`,
    `"${permit.contractor_raw || ''}","Contractor","Associated with active permit","0.55","${permit.city}","","","","From permit contractor field"`,
  ].join('\n');

  return [
    {
      assetType: 'lead_dossier_full',
      format: 'md',
      contentType: 'text/markdown; charset=utf-8',
      fileName: `Dossier_Full_${permit.source_permit_id}.md`,
      body: dossierMd,
      renderHtml: dossierHtml,
    },
    {
      assetType: 'teaser_marketing',
      format: 'md',
      contentType: 'text/markdown; charset=utf-8',
      fileName: `Teaser_Marketing_${permit.source_permit_id}.md`,
      body: teaserMd,
    },
    {
      assetType: 'strategy_playbook',
      format: 'json',
      contentType: 'application/json; charset=utf-8',
      fileName: `Strategy_Playbook_${permit.source_permit_id}.json`,
      body: JSON.stringify(playbook, null, 2),
    },
    {
      assetType: 'buyer_list',
      format: 'csv',
      contentType: 'text/csv; charset=utf-8',
      fileName: `Buyer_List_${permit.source_permit_id}.csv`,
      body: csv,
    },
  ];
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
