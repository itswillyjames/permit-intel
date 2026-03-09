import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface Report { id: string; permit_id: string; status: string; active_version_id: string | null; updated_at: string; }
interface Stage { id: string; stage_name: string; status: string; provider: string | null; started_at: string | null; finished_at: string | null; error_message: string | null; }

const STATUS_COLOR: Record<string, string> = {
  completed: '#22c55e', running: '#3b82f6', queued: '#f59e0b',
  partial: '#f97316', failed: '#ef4444', draft: '#94a3b8',
};

export function ReportQueue() {
  const [reports, setReports] = useState<Report[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [selected, setSelected] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.reports.list();
      setReports(data.reports as Report[]);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const selectReport = async (r: Report) => {
    setSelected(r);
    try {
      const data = await api.reports.stages(r.id);
      setStages(data.stages as Stage[]);
    } catch { setStages([]); }
  };

  const reRun = async (r: Report) => {
    try {
      await api.reports.run(r.id);
      alert('New report version queued');
      load();
    } catch (e) { alert(`Error: ${e}`); }
  };

  useEffect(() => { load(); }, []);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0 }}>Report Queue</h2>
          <button style={btnStyle} onClick={load}>Refresh</button>
        </div>
        {loading ? <p>Loading…</p> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {reports.length === 0 && <p style={{ color: '#888' }}>No reports yet. Run a report from the Shortlist.</p>}
            {reports.map(r => (
              <div key={r.id} onClick={() => selectReport(r)} style={{ ...card, cursor: 'pointer', border: selected?.id === r.id ? '2px solid #1a3a5c' : '2px solid transparent' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: '#888' }}>{r.id.slice(0, 8)}…</span>
                  <span style={{ background: STATUS_COLOR[r.status] ?? '#94a3b8', color: 'white', borderRadius: 4, padding: '2px 8px', fontSize: '0.8rem' }}>{r.status}</span>
                </div>
                <div style={{ marginTop: '0.3rem', fontSize: '0.85rem', color: '#555' }}>Permit: {r.permit_id.slice(0, 8)}… | Updated: {r.updated_at.slice(0, 16)}</div>
                <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
                  {(r.status === 'failed' || r.status === 'partial' || r.status === 'completed') && (
                    <button style={btnSmall} onClick={e => { e.stopPropagation(); reRun(r); }}>Re-run</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <h2 style={{ marginTop: 0 }}>Stage Details</h2>
        {!selected ? <p style={{ color: '#888' }}>Select a report to see stages.</p> : (
          <div>
            <p style={{ fontSize: '0.85rem', color: '#555', marginTop: 0 }}>Report <code>{selected.id.slice(0, 12)}…</code></p>
            {stages.length === 0 && <p style={{ color: '#888' }}>No stages yet.</p>}
            {stages.map(s => (
              <div key={s.id} style={{ ...card, marginBottom: '0.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong>{s.stage_name}</strong>
                  <span style={{ background: STATUS_COLOR[s.status] ?? '#94a3b8', color: 'white', borderRadius: 4, padding: '2px 8px', fontSize: '0.75rem' }}>{s.status}</span>
                </div>
                {s.provider && <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.25rem' }}>Provider: {s.provider}</div>}
                {s.started_at && <div style={{ fontSize: '0.8rem', color: '#666' }}>Started: {s.started_at.slice(0, 16)}</div>}
                {s.error_message && <div style={{ fontSize: '0.8rem', color: '#ef4444', marginTop: '0.25rem' }}>Error: {s.error_message.slice(0, 100)}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const card: React.CSSProperties = { background: 'white', borderRadius: 8, padding: '0.75rem 1rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' };
const btnStyle: React.CSSProperties = { padding: '0.4rem 0.8rem', background: '#1a3a5c', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem' };
const btnSmall: React.CSSProperties = { ...btnStyle, padding: '0.2rem 0.5rem', fontSize: '0.75rem' };
