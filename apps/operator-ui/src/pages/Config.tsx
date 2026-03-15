import React, { useState, useEffect } from 'react';

const S = {
  page: { maxWidth: 520, margin: '0 auto', paddingTop: '2rem' } as React.CSSProperties,
  card: {
    background: '#0f1923',
    border: '1px solid #1e3448',
    borderRadius: 6,
    padding: '1.5rem',
    marginBottom: '1rem',
  } as React.CSSProperties,
  label: {
    display: 'block',
    fontSize: '0.7rem',
    fontFamily: 'monospace',
    letterSpacing: '0.1em',
    color: '#4a9eff',
    textTransform: 'uppercase' as const,
    marginBottom: '0.4rem',
  } as React.CSSProperties,
  input: {
    width: '100%',
    boxSizing: 'border-box' as const,
    background: '#06111a',
    border: '1px solid #1e3448',
    color: '#e2e8f0',
    fontFamily: 'monospace',
    fontSize: '0.85rem',
    padding: '0.5rem 0.75rem',
    borderRadius: 4,
    outline: 'none',
    marginBottom: '1rem',
  } as React.CSSProperties,
  row: { display: 'flex', gap: '0.75rem', marginTop: '0.5rem', flexWrap: 'wrap' as const } as React.CSSProperties,
  btn: {
    padding: '0.5rem 1.25rem',
    background: '#1d4ed8',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: '0.8rem',
    letterSpacing: '0.05em',
  } as React.CSSProperties,
  btnSave: {
    padding: '0.5rem 1.25rem',
    background: '#0f766e',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: '0.8rem',
    letterSpacing: '0.05em',
  } as React.CSSProperties,

  runtimeCard: {
    background: '#06111a',
    border: '1px solid #1e3448',
    borderRadius: 4,
    padding: '0.75rem',
    marginTop: '1rem',
  } as React.CSSProperties,
  runtimeRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '0.75rem',
    fontFamily: 'monospace',
    fontSize: '0.74rem',
    color: '#94a3b8',
    marginBottom: '0.35rem',
  } as React.CSSProperties,
  btnReset: {
    padding: '0.5rem 1.25rem',
    background: '#7f1d1d',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: '0.8rem',
    letterSpacing: '0.05em',
  } as React.CSSProperties,
  status: (ok: boolean | null) => ({
    fontFamily: 'monospace',
    fontSize: '0.8rem',
    padding: '0.4rem 0.75rem',
    borderRadius: 4,
    marginTop: '0.75rem',
    background: ok === null ? '#1e3448' : ok ? '#064e3b' : '#450a0a',
    color: ok === null ? '#94a3b8' : ok ? '#34d399' : '#f87171',
    border: `1px solid ${ok === null ? '#1e3448' : ok ? '#065f46' : '#7f1d1d'}`,
  } as React.CSSProperties),
  heading: {
    fontFamily: 'monospace',
    fontSize: '0.65rem',
    letterSpacing: '0.15em',
    color: '#475569',
    textTransform: 'uppercase' as const,
    marginBottom: '1.25rem',
    borderBottom: '1px solid #1e3448',
    paddingBottom: '0.5rem',
  } as React.CSSProperties,
};

export function Config() {
  const [workerUrl, setWorkerUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [connStatus, setConnStatus] = useState<boolean | null>(null);
  const [connMsg, setConnMsg] = useState('');
  const [saved, setSaved] = useState(false);

  const envWorkerUrl = (import.meta as any).env?.VITE_DEFAULT_WORKER_URL || '';

  useEffect(() => {
    setWorkerUrl(localStorage.getItem('workerUrl') || envWorkerUrl);
    setApiKey(localStorage.getItem('apiKey') || '');
  }, [envWorkerUrl]);

  const save = () => {
    localStorage.setItem('workerUrl', workerUrl.trim().replace(/\/$/, ''));
    localStorage.setItem('apiKey', apiKey.trim());
    setSaved(true);
    setConnStatus(null);
    setTimeout(() => setSaved(false), 2000);
  };

  const clearAndReload = () => {
    localStorage.removeItem('workerUrl');
    localStorage.removeItem('apiKey');
    setWorkerUrl(envWorkerUrl);
    setApiKey('');
    setConnStatus(null);
    setConnMsg('');
    setSaved(false);
    window.location.reload();
  };

  const runtimeWorkerUrl = (localStorage.getItem('workerUrl') || envWorkerUrl)
    .trim()
    .replace(/\/$/, '');
  const runtimeApiKey = localStorage.getItem('apiKey') || '';
  const maskedApiKey = runtimeApiKey
    ? `${'*'.repeat(Math.min(runtimeApiKey.length, 8))} (${runtimeApiKey.length} chars)`
    : 'not set';

  const testConnection = async () => {
    setConnStatus(null);
    setConnMsg('Testing…');
    const url = (workerUrl || '').trim().replace(/\/$/, '');
    const key = (apiKey || '').trim();
    try {
      const resp = await fetch(`${url}/api/permits`, {
        headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      });
      if (resp.ok) {
        const d = await resp.json() as { permits: unknown[] };
        setConnStatus(true);
        setConnMsg(`✓ Connected — ${d.permits?.length ?? 0} permits returned`);
      } else {
        setConnStatus(false);
        setConnMsg(`✗ HTTP ${resp.status} — check Worker URL and API key`);
      }
    } catch (e) {
      setConnStatus(false);
      setConnMsg(`✗ Network error: ${String(e).slice(0, 80)}`);
    }
  };

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={S.heading}>// operator config</div>

        <label style={S.label}>Worker URL</label>
        <input
          id="worker-url"
          name="workerUrl"
          style={S.input}
          value={workerUrl}
          onChange={e => setWorkerUrl(e.target.value)}
          placeholder="https://permit-intel-worker.permit-intel.workers.dev"
          spellCheck={false}
        />

        <label style={S.label}>API Key</label>
        <input
          id="api-key"
          name="apiKey"
          style={S.input}
          type="password"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder="your-api-key"
          spellCheck={false}
        />

        <div style={S.row}>
          <button style={S.btnSave} onClick={save}>
            {saved ? '✓ Saved' : 'Save Config'}
          </button>
          <button style={S.btn} onClick={testConnection}>
            Test Connection
          </button>
          <button style={S.btnReset} onClick={clearAndReload}>
            Clear / Reset
          </button>
        </div>

        {connMsg && (
          <div style={S.status(connStatus)}>{connMsg}</div>
        )}

        <div style={S.runtimeCard}>
          <div style={{ ...S.label, marginBottom: '0.6rem' }}>Active Runtime Config</div>
          <div style={S.runtimeRow}>
            <span>Worker URL</span>
            <code>{runtimeWorkerUrl || '(empty)'}</code>
          </div>
          <div style={S.runtimeRow}>
            <span>API Key</span>
            <code>{maskedApiKey}</code>
          </div>
        </div>
      </div>

      <div style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: '#334155', lineHeight: 1.8 }}>
        <div>// config stored in localStorage — never sent to build pipeline</div>
        <div>// api key transmitted via x-api-key header on all requests</div>
        <div>// iframe export preview uses ?key= (scoped to GET /api/exports/:id/html)</div>
      </div>
    </div>
  );
}
