import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface Suggestion {
  id: string;
  entity_a_id: string; entity_a_name: string;
  entity_b_id: string; entity_b_name: string;
  match_tier: string; confidence: number; rule: string;
}

export function EntityReview() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.entities.suggestions();
      setSuggestions(data.suggestions as Suggestion[]);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const merge = async (s: Suggestion) => {
    if (!confirm(`Merge "${s.entity_b_name}" into "${s.entity_a_name}"?`)) return;
    setWorking(s.id);
    try {
      await api.entities.merge(s.entity_a_id, s.entity_b_id);
      alert('Merged successfully');
      load();
    } catch (e) { alert(`Error: ${e}`); }
    setWorking(null);
  };

  const reject = async (s: Suggestion) => {
    // Mark suggestion rejected — for MVP just remove from view
    setSuggestions(prev => prev.filter(x => x.id !== s.id));
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>Entity Review Queue</h2>
        <button style={btnStyle} onClick={load}>Refresh</button>
      </div>
      <p style={{ color: '#555', fontSize: '0.9rem' }}>
        Probable matches found by the entity resolution engine. Review each pair and merge or reject.
        Fuzzy matches are <strong>never auto-merged</strong>.
      </p>
      {loading ? <p>Loading…</p> : (
        <>
          {suggestions.length === 0 && (
            <div style={{ background: 'white', borderRadius: 8, padding: '2rem', textAlign: 'center', color: '#888', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              No pending match suggestions.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {suggestions.map(s => (
              <div key={s.id} style={{ background: 'white', borderRadius: 8, padding: '1rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'grid', gridTemplateColumns: '1fr auto 1fr auto', alignItems: 'center', gap: '1rem' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{s.entity_a_name}</div>
                  <div style={{ fontSize: '0.8rem', color: '#888', fontFamily: 'monospace' }}>{s.entity_a_id.slice(0,8)}…</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.75rem', background: s.match_tier === 'exact' ? '#dcfce7' : '#fef3c7', color: s.match_tier === 'exact' ? '#166534' : '#92400e', padding: '2px 8px', borderRadius: 4, marginBottom: '0.25rem' }}>{s.match_tier}</div>
                  <div style={{ fontWeight: 700, color: '#1a3a5c' }}>{(s.confidence * 100).toFixed(0)}%</div>
                  <div style={{ fontSize: '0.75rem', color: '#888' }}>{s.rule}</div>
                </div>
                <div>
                  <div style={{ fontWeight: 600 }}>{s.entity_b_name}</div>
                  <div style={{ fontSize: '0.8rem', color: '#888', fontFamily: 'monospace' }}>{s.entity_b_id.slice(0,8)}…</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <button style={{ ...btnStyle, background: '#22c55e' }} disabled={working === s.id} onClick={() => merge(s)}>
                    {working === s.id ? '…' : '✓ Merge'}
                  </button>
                  <button style={{ ...btnStyle, background: '#ef4444' }} onClick={() => reject(s)}>
                    ✗ Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = { padding: '0.4rem 0.8rem', color: 'white', background: '#1a3a5c', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem' };
