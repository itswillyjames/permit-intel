// packages/export/src/renderers/html-renderer.ts
// Server-side HTML dossier renderer. Template versioned. Reproducible from snapshot.

import { escapeHtml } from "@permit-intel/shared";
import type { DossierComposeOutput } from "@permit-intel/shared";

export const CURRENT_TEMPLATE_VERSION = "1.0.0";

export interface DossierRenderInput {
  reportVersionId: string;
  permitId: string;
  dossier: DossierComposeOutput;
  generatedAt: string;
  templateVersion?: string;
}

export function renderDossierHTML(input: DossierRenderInput): string {
  const { dossier: data, generatedAt, templateVersion = CURRENT_TEMPLATE_VERSION } = input;
  const d = data.dossier;
  const p = d.project;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(d.headline)} — Permit Intel Dossier</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      font-size: 14px; line-height: 1.6; color: #1a1a1a;
      max-width: 900px; margin: 0 auto; padding: 32px 24px;
      background: #fff;
    }
    .header { border-bottom: 3px solid #1a56db; padding-bottom: 20px; margin-bottom: 32px; }
    .badge { display: inline-block; background: #1a56db; color: #fff;
      font-size: 11px; font-weight: 700; letter-spacing: 0.5px;
      padding: 3px 10px; border-radius: 3px; text-transform: uppercase; margin-bottom: 8px; }
    h1 { font-size: 26px; font-weight: 700; margin: 8px 0; }
    h2 { font-size: 16px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.5px; color: #4b5563; border-bottom: 1px solid #e5e7eb;
      padding-bottom: 6px; margin: 32px 0 16px; }
    h3 { font-size: 14px; font-weight: 600; margin: 16px 0 6px; }
    .meta { color: #6b7280; font-size: 13px; }
    .summary { font-size: 15px; background: #f9fafb; border-left: 4px solid #1a56db;
      padding: 16px 20px; border-radius: 0 6px 6px 0; margin: 24px 0; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; }
    .card-label { font-size: 11px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.5px; color: #9ca3af; margin-bottom: 4px; }
    .card-value { font-size: 18px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { background: #f9fafb; font-weight: 600; text-align: left;
      padding: 8px 12px; border-bottom: 1px solid #e5e7eb; }
    td { padding: 8px 12px; border-bottom: 1px solid #f3f4f6; }
    tr:last-child td { border-bottom: none; }
    .confidence { display: inline-block; padding: 2px 8px; border-radius: 12px;
      font-size: 11px; font-weight: 600; }
    .conf-high { background: #dcfce7; color: #166534; }
    .conf-med { background: #fef9c3; color: #854d0e; }
    .conf-low { background: #fee2e2; color: #991b1b; }
    ul { margin: 0; padding: 0 0 0 20px; }
    li { margin: 4px 0; }
    .playbook-section { background: #f0f9ff; border: 1px solid #bae6fd;
      border-radius: 8px; padding: 20px; margin: 16px 0; }
    .playbook-section h3 { color: #0369a1; margin-top: 0; }
    .evidence-table { margin-top: 8px; }
    .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #e5e7eb;
      color: #9ca3af; font-size: 12px; display: flex; justify-content: space-between; }
    @media print {
      body { padding: 0; }
      .header { border-color: #000; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="badge">Permit Intel — Operational Dossier</div>
    <h1>${escapeHtml(d.headline)}</h1>
    <div class="meta">
      Generated ${escapeHtml(generatedAt)} &nbsp;·&nbsp;
      Template v${escapeHtml(templateVersion)} &nbsp;·&nbsp;
      Report Version: <code>${escapeHtml(input.reportVersionId)}</code>
    </div>
  </div>

  <div class="summary">${escapeHtml(d.summary)}</div>

  <h2>Project Overview</h2>
  <div class="grid-2">
    <div class="card">
      <div class="card-label">Address</div>
      <div class="card-value" style="font-size:15px">${escapeHtml(p.address)}, ${escapeHtml(p.city)}</div>
    </div>
    <div class="card">
      <div class="card-label">Permit Valuation</div>
      <div class="card-value">$${(p.valuation ?? 0).toLocaleString()}</div>
    </div>
    <div class="card">
      <div class="card-label">Work Type</div>
      <div class="card-value" style="font-size:15px">${escapeHtml(p.work_type)}</div>
    </div>
    <div class="card">
      <div class="card-label">Filed / Issued</div>
      <div class="card-value" style="font-size:15px">
        ${escapeHtml(p.timeline.filed_date || "—")} / ${escapeHtml(p.timeline.issued_date || "—")}
      </div>
    </div>
  </div>

  <h2>Key Entities</h2>
  <table>
    <thead>
      <tr>
        <th>Role</th>
        <th>Name</th>
        <th>Confidence</th>
        <th>Contacts</th>
      </tr>
    </thead>
    <tbody>
      ${d.key_entities.map((e) => `
      <tr>
        <td>${escapeHtml(e.role)}</td>
        <td><strong>${escapeHtml(e.canonical_name)}</strong></td>
        <td>${confidenceBadge(e.confidence)}</td>
        <td>${e.contacts.map((c) => escapeHtml(c)).join(", ") || "—"}</td>
      </tr>`).join("")}
    </tbody>
  </table>

  <h2>Recommended Next Steps</h2>
  <ul>
    ${d.recommended_next_steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}
  </ul>

  <h2>Resale Playbook</h2>

  ${playbookSection("Positioning", data.playbook.positioning)}
  ${playbookSection("Buyer Targets", data.playbook.buyer_targets)}
  ${playbookSection("Pricing Logic", data.playbook.pricing_logic)}
  ${playbookSection("Objections & Rebuttals", data.playbook.objections_and_rebuttals)}

  <h2>Evidence Index</h2>
  <table class="evidence-table">
    <thead>
      <tr><th>#</th><th>Title</th><th>Source</th><th>Retrieved</th></tr>
    </thead>
    <tbody>
      ${d.evidence_index.map((ev, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(ev.title)}</td>
        <td><small>${escapeHtml(ev.source)}</small></td>
        <td><small>${escapeHtml(ev.retrieved_at)}</small></td>
      </tr>`).join("")}
    </tbody>
  </table>

  <div class="footer">
    <span>Permit Intel &copy; ${new Date().getFullYear()} — Single Operator Edition</span>
    <span>Permit ID: ${escapeHtml(input.permitId)}</span>
  </div>
</body>
</html>`;
}

function confidenceBadge(conf: number): string {
  const cls = conf >= 0.8 ? "conf-high" : conf >= 0.5 ? "conf-med" : "conf-low";
  return `<span class="confidence ${cls}">${Math.round(conf * 100)}%</span>`;
}

function playbookSection(title: string, items: string[]): string {
  return `<div class="playbook-section">
  <h3>${escapeHtml(title)}</h3>
  <ul>${items.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>
</div>`;
}
