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

const copy = (text: string) => navigator.clipboard.writeText(text).catch(() => {});

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
      <h2 style={{ marginTop: 0, fontFamily: 'monospace', fontSize: '0.7rem', letterSpacing: '0.15em',
                   color: '#4a9eff', textTransform: 'uppercase', borderBottom: '1px solid #0f2236',
                   paddingBottom: '0.5rem' }}>
        // permit shortlist
      </h2>
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
        <select value={city} onChange={e => setCity(e.target.value)} style={inputStyle}>
          <option value="">All Cities</option>
          {['chicago','seattle','denver','cincinnati','austin'].map(c => (
            <option key={c} value={c}>{c.charAt(0).toUpperCase()+c.slice(1)}</option>
          ))}
        </select>
        <input
          placeholder="Min Score (0-1)"
          value={minScore}
          onChange={e => setMinScore(e.target.value)}
          style={{ ...inputStyle, width: 150 }}
        />
        <button onClick={load} style={btnStyle}>Refresh</button>
      </div>
      {loading ? (
        <div style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: '#334155' }}>loading…</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
          <thead>
            <tr style={{ background: '#0a1520', color: '#475569' }}>
              {['City','Address','Type','Valuation','Score','Status','Actions'].map(h => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {permits.length === 0 && (
              <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#334155', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                No permits found.
              </td></tr>
            )}
            {permits.map(p => (
              <tr key={p.id} style={{ borderBottom: '1px solid #0a1520' }}>
                <td style={tdStyle}>{p.city}</td>
                <td style={tdStyle}>
                  <button
                    style={{ background: 'none', border: 'none', color: '#4a9eff', cursor: 'pointer',
                             fontFamily: 'monospace', fontSize: '0.78rem', textAlign: 'left', padding: 0 }}
                    onClick={() => setSelected(p)}
                  >
                    {p.address_norm || '—'}
                  </button>
                </td>
                <td style={tdStyle}>{p.work_type || '—'}</td>
                <td style={tdStyle}>{p.valuation ? `$${p.valuation.toLocaleString()}` : '—'}</td>
                <td style={tdStyle}>
                  <span style={{ fontWeight: 700, color: p.prequal_score >= 0.65 ? '#22c55e' : '#f59e0b',
                                 fontFamily: 'monospace' }}>
                    {(p.prequal_score * 100).toFixed(0)}%
                  </span>
                </td>
                <td style={tdStyle}>
                  <span style={{ background: STATUS_COLORS[p.status] ?? '#1e3448', color: 'white',
                                 borderRadius: 3, padding: '2px 7px', fontSize: '0.7rem',
                                 fontFamily: 'monospace' }}>
                    {p.status}
                  </span>
                </td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', gap: '0.35rem' }}>
                    <button style={btnSmall} onClick={() => createReport(p)}>run</button>
                    <button style={{ ...btnSmall, background: '#1e3448' }}
                            title="Copy permit ID"
                            onClick={() => copy(p.id)}>⎘</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selected && (
        <div style={modalOverlay} onClick={() => setSelected(null)}>
          <div style={modalBox} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: 'monospace', fontSize: '0.65rem', color: '#4a9eff',
                          letterSpacing: '0.12em', marginBottom: '0.75rem' }}>
              // PERMIT DETAIL
            </div>
            <h3 style={{ marginTop: 0, color: '#e2e8f0', fontSize: '0.95rem' }}>{selected.address_norm}</h3>
            <div style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#94a3b8',
                          display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <span>{selected.id}</span>
              <button style={{ ...btnSmall, background: '#1e3448', padding: '1px 6px' }}
                      onClick={() => copy(selected.id)}>⎘</button>
            </div>
            {[
              ['City', selected.city],
              ['Work Type', selected.work_type],
              ['Valuation', selected.valuation ? `$${selected.valuation.toLocaleString()}` : '—'],
              ['Filed', selected.filed_date],
              ['Prequal Score', `${(selected.prequal_score * 100).toFixed(1)}%`],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: '1rem', marginBottom: '0.35rem',
                                    fontFamily: 'monospace', fontSize: '0.78rem' }}>
                <span style={{ color: '#475569', minWidth: 110 }}>{k}</span>
                <span style={{ color: '#cbd5e1' }}>{v}</span>
              </div>
            ))}
            <div style={{ marginTop: '0.75rem', fontFamily: 'monospace', fontSize: '0.72rem', color: '#475569' }}>
              Reasons:
            </div>
            <ul style={{ marginTop: '0.3rem', paddingLeft: '1.25rem', fontFamily: 'monospace',
                         fontSize: '0.72rem', color: '#94a3b8' }}>
              {(JSON.parse(selected.prequal_reasons_json || '[]') as string[]).map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            <button style={{ ...btnStyle, marginTop: '1rem' }} onClick={() => setSelected(null)}>close</button>
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '0.4rem 0.6rem', background: '#0a1520', border: '1px solid #1e3448',
  borderRadius: 3, color: '#cbd5e1', fontFamily: 'monospace', fontSize: '0.78rem',
};
const btnStyle: React.CSSProperties = {
  padding: '0.4rem 0.9rem', background: '#1d4ed8', color: 'white', border: 'none',
  borderRadius: 3, cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.78rem',
};
const btnSmall: React.CSSProperties = {
  ...btnStyle, padding: '0.2rem 0.5rem', fontSize: '0.72rem', background: '#0f2236',
};
const thStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600,
  fontFamily: 'monospace', fontSize: '0.68rem', letterSpacing: '0.08em',
};
const tdStyle: React.CSSProperties = { padding: '0.45rem 0.75rem', color: '#94a3b8' };
const modalOverlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};
const modalBox: React.CSSProperties = {
  background: '#0a1520', border: '1px solid #1e3448', borderRadius: 6,
  padding: '1.5rem', maxWidth: 520, width: '90%', maxHeight: '80vh', overflow: 'auto',
};
