import React, { useEffect, useMemo, useState } from 'react';
import { api, getConfig } from '../lib/api';

interface PermitApi {
  id: string;
  city: string;
  source_permit_id: string;
  address_norm: string | null;
  address_raw: string | null;
  work_type: string | null;
  description_raw: string | null;
  valuation: number | null;
  applicant_raw: string | null;
  contractor_raw: string | null;
  owner_raw: string | null;
  filed_date: string | null;
  issued_date: string | null;
  status: string;
  prequal_score: number;
}

interface LeadViewModel {
  id: string;
  title: string;
  city: string;
  category: string;
  tier: string;
  phase: string;
  valueLabel: string;
  permit: PermitApi;
}

interface DealAsset {
  export_id: string;
  asset_type: string;
  status: string;
  content_type: string;
  file_name: string;
  download_url: string;
  preview_url: string;
}

interface EvidenceItem {
  id: string;
  title: string | null;
  source: string;
  retrieved_at: string;
}

function toLeadViewModel(permit: PermitApi): LeadViewModel {
  const score = Number(permit.prequal_score ?? 0);
  const tier = score >= 0.75 ? 'Tier A' : score >= 0.5 ? 'Tier B' : 'Tier C';
  const phase = permit.issued_date ? 'Permit Issued' : permit.filed_date ? 'Filed' : 'Unknown';
  return {
    id: permit.id,
    title: permit.address_norm || permit.address_raw || permit.source_permit_id,
    city: permit.city,
    category: permit.work_type || 'Unknown category',
    tier,
    phase,
    valueLabel: permit.valuation ? `$${Number(permit.valuation).toLocaleString()}` : 'Not listed',
    permit,
  };
}

export function LeadsHub() {
  const [leads, setLeads] = useState<LeadViewModel[]>([]);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<LeadViewModel | null>(null);
  const [assets, setAssets] = useState<DealAsset[]>([]);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(
    () => leads.filter((lead) => `${lead.title} ${lead.permit.applicant_raw || ''} ${lead.category}`.toLowerCase().includes(query.toLowerCase())),
    [leads, query],
  );

  useEffect(() => {
    api.permits.list({ limit: '100' })
      .then((d) => {
        const mapped = ((d.permits as PermitApi[]) || []).map(toLeadViewModel);
        setLeads(mapped);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setError('');
    Promise.all([
      api.permits.get(selectedId),
      api.leads.assets(selectedId),
      api.leads.evidence(selectedId),
    ])
      .then(([permitResp, assetsResp, evidenceResp]) => {
        const permit = permitResp.permit as PermitApi;
        setSelected(toLeadViewModel(permit));
        setAssets((assetsResp.assets || []) as DealAsset[]);
        setEvidence((evidenceResp.evidence || []) as EvidenceItem[]);
      })
      .catch((e) => setError(String(e)));
  }, [selectedId]);

  const generate = async () => {
    if (!selectedId) return;
    setBusy(true);
    setError('');
    try {
      await api.leads.generateAssets(selectedId);
      const [assetsResp, evidenceResp] = await Promise.all([api.leads.assets(selectedId), api.leads.evidence(selectedId)]);
      setAssets((assetsResp.assets || []) as DealAsset[]);
      setEvidence((evidenceResp.evidence || []) as EvidenceItem[]);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const loadPreview = async (asset: DealAsset) => {
    const { key } = getConfig();
    const resp = await fetch(asset.preview_url, { headers: { 'x-api-key': key } });
    if (!resp.ok) {
      setPreview(`Preview unavailable (${resp.status}).`);
      return;
    }
    setPreview(await resp.text());
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '330px 1fr 320px', gap: 12, minHeight: '80vh' }}>
      <section style={panel}>
        <h3 style={h3}>⬡ Leads</h3>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search leads" style={input} />
        <div style={{ marginTop: 8, maxHeight: '75vh', overflow: 'auto' }}>
          {filtered.length === 0 && <div style={{ color: '#64748b', fontSize: 12 }}>No leads match current filters.</div>}
          {filtered.map((lead) => (
            <button key={lead.id} onClick={() => setSelectedId(lead.id)} style={{ ...leadBtn, borderColor: selectedId === lead.id ? '#4a9eff' : '#243b53' }}>
              <div style={{ color: '#e2e8f0', fontWeight: 700 }}>{lead.title}</div>
              <div style={{ color: '#8fbef5', fontSize: 12 }}>{lead.tier} · {lead.city}</div>
              <div style={{ color: '#94a3b8', fontSize: 12 }}>{lead.category} · {lead.valueLabel}</div>
              <div style={{ color: '#64748b', fontSize: 11 }}>{lead.phase}</div>
            </button>
          ))}
        </div>
      </section>

      <section style={panel}>
        <h3 style={h3}>OSINT Hub</h3>
        {error && <div style={{ color: '#fecaca', fontSize: 12 }}>{error}</div>}
        {!selected && <div style={{ color: '#64748b' }}>Select a lead.</div>}
        {selected && (
          <>
            <div style={{ color: '#e2e8f0', fontSize: 20, fontWeight: 700 }}>{selected.title}</div>
            <div style={grid2}>
              <Card title="Contact Intelligence" lines={[
                `Applicant: ${selected.permit.applicant_raw || 'Not listed'}`,
                `Owner: ${selected.permit.owner_raw || 'Not listed'}`,
                `Contractor: ${selected.permit.contractor_raw || 'Not listed'}`,
              ]} />
              <Card title="Project Signals" lines={[
                `Valuation: ${selected.valueLabel}`,
                `Intent: ${selected.category}`,
                `Timeline: ${selected.permit.filed_date || 'N/A'} → ${selected.permit.issued_date || 'N/A'}`,
              ]} />
            </div>
            <Card title="Description + NLP/Structured Analysis" lines={[selected.permit.description_raw || 'No description available from source permit data.']} />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button style={actionBtn} onClick={generate} disabled={busy}>{busy ? 'Generating…' : 'Generate Assets'}</button>
              <button style={actionBtnSecondary} onClick={() => setSelectedId(selected.id)}>Refresh</button>
            </div>

            <h4 style={h4}>Asset Locker</h4>
            <div style={assetGrid}>
              {assets.length === 0 && <div style={{ color: '#64748b' }}>No assets yet. Generate to create 4 resale-ready files.</div>}
              {assets.map((asset) => (
                <div key={asset.export_id} style={assetCard}>
                  <div style={{ color: '#e2e8f0', fontSize: 12 }}>{asset.asset_type}</div>
                  <div style={{ color: '#64748b', fontSize: 11 }}>{asset.file_name}</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <a style={linkBtn} href={asset.download_url} target="_blank" rel="noreferrer">Download</a>
                    <button style={miniBtn} onClick={() => loadPreview(asset)}>Preview</button>
                  </div>
                </div>
              ))}
            </div>
            {preview && <pre style={previewBox}>{preview.slice(0, 6000)}</pre>}
          </>
        )}
      </section>

      <aside style={panel}>
        <h3 style={h3}>Sales Strategist</h3>
        <Card
          title="Forensic Value Signals"
          lines={selected ? [selected.category, `Prequal score ${(Number(selected.permit.prequal_score || 0) * 100).toFixed(0)}%`, selected.phase] : ['Select a lead']}
        />
        <Card title="Market Signal Pack" lines={['Municipal filing and valuation signals indicate active project intent.']} />
        <Card title="Buyer Targets + Pricing" lines={['Price against valuation signal and urgency; keep buyer outreach evidence-backed.']} />
        <h4 style={h4}>Verified Sources</h4>
        <div>
          {evidence.length === 0 && <div style={{ color: '#64748b', fontSize: 12 }}>No evidence linked yet.</div>}
          {evidence.map((item) => (
            <div key={item.id} style={{ fontSize: 12, color: '#93c5fd', marginBottom: 8 }}>
              {item.title || item.source}
              <br />
              <span style={{ color: '#64748b' }}>{item.source} · {item.retrieved_at}</span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function Card({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div style={card}>
      <div style={{ color: '#4a9eff', fontSize: 11, marginBottom: 6 }}>{title}</div>
      {lines.map((line) => (
        <div key={`${title}-${line}`} style={{ color: '#cbd5e1', fontSize: 12, marginBottom: 4 }}>{line}</div>
      ))}
    </div>
  );
}

const panel: React.CSSProperties = { border: '1px solid #1e3448', borderRadius: 8, padding: 12, background: '#0b1623' };
const h3: React.CSSProperties = { margin: '0 0 8px', color: '#e2e8f0' };
const h4: React.CSSProperties = { color: '#94a3b8', margin: '10px 0 6px', fontSize: 13 };
const input: React.CSSProperties = { width: '100%', background: '#0a1520', border: '1px solid #1e3448', color: '#cbd5e1', padding: '8px' };
const leadBtn: React.CSSProperties = { display: 'block', width: '100%', textAlign: 'left', marginBottom: 8, background: '#111f2f', border: '1px solid #243b53', borderRadius: 6, padding: 8 };
const grid2: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 };
const card: React.CSSProperties = { border: '1px solid #1e3448', borderRadius: 6, background: '#0a1520', padding: 8 };
const actionBtn: React.CSSProperties = { background: '#16a34a', border: 'none', color: '#fff', padding: '8px 10px', borderRadius: 4 };
const actionBtnSecondary: React.CSSProperties = { background: '#1e3a8a', border: 'none', color: '#fff', padding: '8px 10px', borderRadius: 4 };
const assetGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 };
const assetCard: React.CSSProperties = { border: '1px solid #1e3448', borderRadius: 6, background: '#0a1520', padding: 8 };
const miniBtn: React.CSSProperties = { background: '#0f2236', border: '1px solid #1e3448', color: '#cbd5e1', fontSize: 11, padding: '4px 8px' };
const linkBtn: React.CSSProperties = { ...miniBtn, textDecoration: 'none', display: 'inline-block' };
const previewBox: React.CSSProperties = { marginTop: 10, maxHeight: 260, overflow: 'auto', fontSize: 11, background: '#020617', color: '#e2e8f0', padding: 8 };
