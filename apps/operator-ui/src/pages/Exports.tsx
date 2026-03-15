import React, { useEffect, useState, useRef } from 'react';
import { api } from '../lib/api';

interface Report {
  id: string;
  status: string;
  active_version_id: string | null;
  permit_id: string;
}

interface ExportRecord {
  id: string;
  status: string;
  checksum_html: string | null;
  html_storage_ref: string | null;
  created_at: string;
}

const S: Record<string, React.CSSProperties> = {
  h2: { marginTop: 0, fontFamily: 'monospace', fontSize: '0.7rem', letterSpacing: '0.15em',
        color: '#4a9eff', textTransform: 'uppercase', borderBottom: '1px solid #0f2236',
        paddingBottom: '0.5rem', marginBottom: '1rem' },
  card: { background: '#0a1520', border: '1px solid #0f2236', borderRadius: 4,
          padding: '0.75rem 1rem', marginBottom: '0.5rem' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' },
  meta: { fontFamily: 'monospace', fontSize: '0.72rem', color: '#475569' },
  badge: (s: string): React.CSSProperties => ({
    fontFamily: 'monospace', fontSize: '0.65rem', padding: '2px 7px', borderRadius: 3,
    background: s === 'completed' || s === 'partial' ? '#064e3b' : '#1e3448',
    color: s === 'completed' || s === 'partial' ? '#34d399' : '#94a3b8',
    border: `1px solid ${s === 'completed' ? '#065f46' : '#1e3448'}`,
  }),
  ref: { fontFamily: 'monospace', fontSize: '0.65rem', color: '#22c55e',
         marginTop: '0.35rem', wordBreak: 'break-all' },
  btnRow: { display: 'flex', gap: '0.5rem', flexShrink: 0 },
  btn: (variant: 'primary'|'green'|'dim'): React.CSSProperties => ({
    padding: '0.35rem 0.85rem', border: 'none', borderRadius: 3, cursor: 'pointer',
    fontFamily: 'monospace', fontSize: '0.72rem', letterSpacing: '0.04em',
    background: variant === 'primary' ? '#1d4ed8' : variant === 'green' ? '#065f46' : '#1e3448',
    color: variant === 'dim' ? '#64748b' : '#fff',
  }),
  iframeWrap: {
    marginTop: '1.25rem', border: '1px solid #0f2236', borderRadius: 4, overflow: 'hidden',
  },
  iframeBar: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '0.4rem 0.75rem', background: '#060d14', borderBottom: '1px solid #0f2236',
    fontFamily: 'monospace', fontSize: '0.65rem', color: '#334155',
  },
};

export function ExportPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [exports, setExports] = useState<Map<string, ExportRecord>>(new Map());
  const [working, setWorking] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ exportId: string; url: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    setErrorMsg('');
    api.reports.list()
      .then(d => setReports(d.reports as Report[]))
      .catch((e) => {
        console.error(e);
        const msg = e instanceof Error ? e.message : String(e);
        setErrorMsg(msg.includes('401')
          ? 'Authentication failed (401). Update API key in Config, save, and reload.'
          : `Failed to load reports: ${msg}`);
      });
  }, []);

  const generateExport = async (r: Report) => {
    if (!r.active_version_id) {
      alert('No active report version. Run the report first.');
      return;
    }
    setWorking(r.id);
    try {
      const { export_id } = await api.exports.create(r.id, r.active_version_id);
      const { export: exportRec } = await api.exports.get(export_id) as { export: ExportRecord };
      setExports(prev => new Map(prev).set(r.id, exportRec));
      // Auto-open preview
      setPreview({ exportId: export_id, url: api.exports.htmlUrl(export_id) });
    } catch (e) {
      alert(`Export failed: ${e}`);
    }
    setWorking(null);
  };

  const openPreview = (exp: ExportRecord) => {
    setPreview({ exportId: exp.id, url: api.exports.htmlUrl(exp.id) });
  };

  const openTab = (exp: ExportRecord) => {
    window.open(api.exports.htmlUrl(exp.id), '_blank');
  };

  const copy = (text: string) => navigator.clipboard.writeText(text).catch(() => {});

  const completedReports = reports.filter(
    r => r.status === 'completed' || r.status === 'partial',
  );

  return (
    <div>
      <div style={S.h2}>// dossier exports</div>

      <div style={{ ...S.meta, marginBottom: '0.75rem' }}>
        Preview uses <code>?key=</code> for <code>GET /api/exports/:id/html</code>; all other calls use the <code>x-api-key</code> header.
      </div>

      {errorMsg && (
        <div style={{
          marginBottom: '0.75rem',
          padding: '0.55rem 0.7rem',
          borderRadius: 4,
          border: '1px solid #7f1d1d',
          background: '#450a0a',
          color: '#fecaca',
          fontFamily: 'monospace',
          fontSize: '0.74rem',
        }}>
          {errorMsg}
        </div>
      )}

      {completedReports.length === 0 && (
        <div style={{ ...S.meta, color: '#334155' }}>
          No completed reports. Run a pipeline from Shortlist first.
        </div>
      )}

      {completedReports.map(r => {
        const exp = exports.get(r.id);
        return (
          <div key={r.id} style={S.card}>
            <div style={S.row}>
              <div style={{ minWidth: 0 }}>
                <div style={{ ...S.meta, display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  <span style={S.badge(r.status)}>{r.status}</span>
                  <span>report <code>{r.id.slice(0, 12)}…</code></span>
                  <span style={{ color: '#1e3448' }}>|</span>
                  <span>permit <code>{r.permit_id.slice(0, 8)}…</code></span>
                  <button
                    title="Copy report ID"
                    style={{ ...S.btn('dim'), padding: '1px 6px', fontSize: '0.65rem' }}
                    onClick={() => copy(r.id)}
                  >⎘</button>
                </div>
                {exp && (
                  <>
                    <div style={S.ref}>
                      ✓ export {exp.id.slice(0, 12)}… | {exp.status}
                    </div>
                    {exp.html_storage_ref && (
                      <div style={{ ...S.ref, color: '#4a9eff' }}>
                        ref: {exp.html_storage_ref}
                      </div>
                    )}
                    {exp.checksum_html && (
                      <div style={{ ...S.meta, marginTop: '0.2rem' }}>
                        sha256: {exp.checksum_html.slice(0, 24)}…
                      </div>
                    )}
                  </>
                )}
              </div>
              <div style={S.btnRow}>
                <button
                  style={{ ...S.btn('primary'), opacity: working === r.id ? 0.5 : 1 }}
                  disabled={working === r.id}
                  onClick={() => generateExport(r)}
                >
                  {working === r.id ? 'generating…' : '⬇ generate'}
                </button>
                {exp && (
                  <>
                    <button style={S.btn('green')} onClick={() => openPreview(exp)}>
                      ▣ preview
                    </button>
                    <button style={S.btn('dim')} onClick={() => openTab(exp)}>
                      ↗ tab
                    </button>
                    <button
                      title="Copy export ID"
                      style={{ ...S.btn('dim'), padding: '0.35rem 0.5rem' }}
                      onClick={() => copy(exp.id)}
                    >⎘</button>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {preview && (
        <div style={S.iframeWrap}>
          <div style={S.iframeBar}>
            <span>preview: {preview.exportId.slice(0, 16)}…</span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button style={S.btn('dim')} onClick={() => copy(preview.url)}>⎘ copy url</button>
              <button style={S.btn('dim')} onClick={() => window.open(preview.url, '_blank')}>↗ tab</button>
              <button style={S.btn('dim')} onClick={() => setPreview(null)}>✕ close</button>
            </div>
          </div>
          <iframe
            ref={iframeRef}
            src={preview.url}
            style={{ width: '100%', height: '60vh', border: 'none', background: '#fff' }}
            title="Dossier Preview"
            sandbox="allow-same-origin allow-scripts"
          />
        </div>
      )}
    </div>
  );
}
