import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface Permit {
  id: string; city: string; address_norm: string; work_type: string;
  valuation: number; status: string; prequal_score: number;
  filed_date: string; prequal_reasons_json: string;
}

const STATUS_COLORS: Record<string, string> = {
  shortlisted: '#22c55e', prequalified: '#3b82f6', normalized: '#8b5cf6',
  new: '#94a3b8', rejected: '#ef4444', archived: '#6b7280',
};

export function PermitList() {
  const [permits, setPermits] = useState<Permit[]>([]);
  const [loading, setLoading] = useState(true);
  const [city, setCity] = useState('');
  const [minScore, setMinScore] = useState('');
  const [selected, setSelected] = useState<Permit | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (city) params['city'] = city;
      if (minScore) params['min_score'] = minScore;
      params['status'] = 'shortlisted';
      const data = await api.permits.list(params);
      setPermits(data.permits as Permit[]);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [city, minScore]);

  const createReport = async (permit: Permit) => {
    try {
      const { report } = await api.reports.create(permit.id) as { report: { id: string } };
      await api.reports.run(report.id);
      alert(`Report queued for ${permit.address_norm}`);
    } catch (e) {
      alert(`Error: ${e}`);
    }
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Permit Shortlist</h2>
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <select value={city} onChange={e => setCity(e.target.value)} style={inputStyle}>
          <option value="">All Cities</option>
          {['chicago','seattle','denver','cincinnati','austin'].map(c => (
            <option key={c} value={c}>{c.charAt(0).toUpperCase()+c.slice(1)}</option>
          ))}
        </select>
        <input placeholder="Min Score (0-1)" value={minScore} onChange={e => setMinScore(e.target.value)} style={{ ...inputStyle, width: 160 }} />
        <button onClick={load} style={btnStyle}>Refresh</button>
      </div>
      {loading ? <p>Loading…</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', background: 'white', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <thead>
            <tr style={{ background: '#1a3a5c', color: 'white' }}>
              {['City','Address','Work Type','Valuation','Score','Status','Actions'].map(h => (
                <th key={h} style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {permits.length === 0 && (
              <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>No permits found. Run ingestion to populate.</td></tr>
            )}
            {permits.map((p, i) => (
              <tr key={p.id} style={{ borderBottom: '1px solid #eee', background: i % 2 === 0 ? 'white' : '#f9fafb' }}>
                <td style={tdStyle}>{p.city}</td>
                <td style={tdStyle}><button style={{ background: 'none', border: 'none', color: '#1a3a5c', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setSelected(p)}>{p.address_norm || '—'}</button></td>
                <td style={tdStyle}>{p.work_type || '—'}</td>
                <td style={tdStyle}>{p.valuation ? `$${p.valuation.toLocaleString()}` : '—'}</td>
                <td style={tdStyle}><span style={{ fontWeight: 700, color: p.prequal_score >= 0.65 ? '#22c55e' : '#f59e0b' }}>{(p.prequal_score * 100).toFixed(0)}%</span></td>
                <td style={tdStyle}><span style={{ background: STATUS_COLORS[p.status] ?? '#94a3b8', color: 'white', borderRadius: 4, padding: '2px 8px', fontSize: '0.8rem' }}>{p.status}</span></td>
                <td style={tdStyle}><button style={btnSmall} onClick={() => createReport(p)}>Run Report</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {selected && (
        <div style={modalOverlay} onClick={() => setSelected(null)}>
          <div style={modalBox} onClick={e => e.stopPropagation()}>
            <h3>{selected.address_norm}</h3>
            <p><strong>City:</strong> {selected.city}</p>
            <p><strong>Work Type:</strong> {selected.work_type}</p>
            <p><strong>Valuation:</strong> {selected.valuation ? `$${selected.valuation.toLocaleString()}` : '—'}</p>
            <p><strong>Filed:</strong> {selected.filed_date}</p>
            <p><strong>Prequal Score:</strong> {(selected.prequal_score * 100).toFixed(1)}%</p>
            <p><strong>Reasons:</strong></p>
            <ul>{(JSON.parse(selected.prequal_reasons_json || '[]') as string[]).map((r,i) => <li key={i}>{r}</li>)}</ul>
            <button style={btnStyle} onClick={() => setSelected(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = { padding: '0.5rem', border: '1px solid #ddd', borderRadius: 6, fontSize: '0.9rem' };
const btnStyle: React.CSSProperties = { padding: '0.5rem 1rem', background: '#1a3a5c', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.9rem' };
const btnSmall: React.CSSProperties = { ...btnStyle, padding: '0.25rem 0.6rem', fontSize: '0.8rem' };
const tdStyle: React.CSSProperties = { padding: '0.6rem 0.75rem' };
const modalOverlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const modalBox: React.CSSProperties = { background: 'white', borderRadius: 8, padding: '2rem', maxWidth: 500, width: '90%', maxHeight: '80vh', overflow: 'auto' };
