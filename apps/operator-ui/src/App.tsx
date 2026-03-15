import React, { useState } from 'react';
import { PermitList } from './pages/PermitList';
import { ReportQueue } from './pages/ReportQueue';
import { EntityReview } from './pages/EntityReview';
import { ExportPage } from './pages/Exports';
import { Config } from './pages/Config';

type Page = 'permits' | 'reports' | 'entities' | 'exports' | 'config';

const NAV: Array<{ key: Page; label: string }> = [
  { key: 'permits',  label: '⬡ Shortlist'  },
  { key: 'reports',  label: '⬡ Reports'    },
  { key: 'entities', label: '⬡ Entities'   },
  { key: 'exports',  label: '⬡ Exports'    },
  { key: 'config',   label: '⬡ Config'     },
];

const S: Record<string, React.CSSProperties> = {
  shell: {
    display: 'flex',
    height: '100vh',
    overflow: 'hidden',
    background: '#060d14',
    fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
  },
  sidebar: {
    width: 200,
    background: '#060d14',
    borderRight: '1px solid #0f2236',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
  },
  logo: {
    padding: '1.25rem 1rem 1rem',
    fontSize: '0.7rem',
    fontWeight: 700,
    letterSpacing: '0.18em',
    color: '#4a9eff',
    textTransform: 'uppercase',
    borderBottom: '1px solid #0f2236',
    userSelect: 'none',
  },
  navBtn: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '0.6rem 1rem',
    background: 'transparent',
    border: 'none',
    color: '#475569',
    cursor: 'pointer',
    fontSize: '0.72rem',
    letterSpacing: '0.08em',
    transition: 'color 0.1s',
  },
  navBtnActive: {
    color: '#e2e8f0',
    background: '#0f1923',
    borderLeft: '2px solid #4a9eff',
    paddingLeft: 'calc(1rem - 2px)',
  },
  content: {
    flex: 1,
    overflow: 'auto',
    padding: '1.5rem',
    background: '#080f18',
    color: '#cbd5e1',
  },
};

export function App() {
  const [page, setPage] = useState<Page>('permits');

  return (
    <div style={S.shell}>
      <div style={S.sidebar}>
        <div style={S.logo}>Permit Intel</div>
        {NAV.map((n) => (
          <button
            key={n.key}
            style={{ ...S.navBtn, ...(page === n.key ? S.navBtnActive : {}) }}
            onClick={() => setPage(n.key)}
          >
            {n.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ padding: '0.75rem 1rem', fontSize: '0.6rem', color: '#1e3448', letterSpacing: '0.1em' }}>
          PERMIT INTEL v1
        </div>
      </div>
      <div style={S.content}>
        {page === 'permits'  && <PermitList />}
        {page === 'reports'  && <ReportQueue />}
        {page === 'entities' && <EntityReview />}
        {page === 'exports'  && <ExportPage />}
        {page === 'config'   && <Config />}
      </div>
    </div>
  );
}
