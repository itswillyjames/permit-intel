import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface Report { id: string; status: string; active_version_id: string | null; permit_id: string; }
interface ExportRecord { id: string; status: string; checksum_html: string | null; created_at: string; }

export function ExportPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [exports, setExports] = useState<Map<string, ExportRecord>>(new Map());
  const [working, setWorking] = useState<string | null>(null);

  useEffect(() => {
    api.reports.list().then(d => setReports(d.reports as Report[])).catch(console.error);
  }, []);

  const generateExport = async (r: Report) => {
    if (!r.active_version_id) return alert('No active report version. Run the report first.');
    setWorking(r.id);
    try {
      const { export_id } = await api.exports.create(r.id, r.active_version_id);
      const { export: exportRec } = await api.exports.get(export_id) as { export: ExportRecord };
      setExports(prev => new Map(prev).set(r.id, exportRec));
    } catch (e) { alert(`Export failed: ${e}`); }
    setWorking(null);
  };

  const viewHtml = (exportId: string) => {
    window.open(api.exports.htmlUrl(exportId), '_blank');
  };

  const completedReports = reports.filter(r => r.status === 'completed' || r.status === 'partial');

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Dossier Exports</h2>
      <p style={{ color: '#555', fontSize: '0.9rem' }}>Generate and download HTML dossiers for completed reports.</p>
      {completedReports.length === 0 && <p style={{ color: '#888' }}>No completed reports yet.</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {completedReports.map(r => {
          const exp = exports.get(r.id);
          return (
            <div key={r.id} style={{ background: 'white', borderRadius: 8, padding: '1rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>Report <strong>{r.id.slice(0,8)}…</strong></div>
                <div style={{ fontSize: '0.8rem', color: '#888', marginTop: '0.25rem' }}>Status: {r.status} | Version: {r.active_version_id?.slice(0,8) ?? 'none'}…</div>
                {exp && <div style={{ fontSize: '0.8rem', color: '#22c55e', marginTop: '0.25rem' }}>Export ready — checksum: <code>{exp.checksum_html?.slice(0,16)}…</code></div>}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  style={{ ...btnStyle, opacity: working === r.id ? 0.6 : 1 }}
                  disabled={working === r.id}
                  onClick={() => generateExport(r)}
                >
                  {working === r.id ? 'Generating…' : '⬇ Generate Dossier'}
                </button>
                {exp && (
                  <button style={{ ...btnStyle, background: '#22c55e' }} onClick={() => viewHtml(exp.id)}>
                    🔗 View HTML
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = { padding: '0.5rem 1rem', background: '#1a3a5c', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem' };
