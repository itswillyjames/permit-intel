import React, { useState } from 'react';
import { PermitList } from './pages/PermitList';
import { ReportQueue } from './pages/ReportQueue';
import { EntityReview } from './pages/EntityReview';
import { ExportPage } from './pages/Exports';

type Page = 'permits' | 'reports' | 'entities' | 'exports';

const NAV: Array<{ key: Page; label: string }> = [
  { key: 'permits', label: '🔍 Shortlist' },
  { key: 'reports', label: '📊 Reports' },
  { key: 'entities', label: '🏢 Entities' },
  { key: 'exports', label: '📄 Exports' },
];

const styles: Record<string, React.CSSProperties> = {
  shell: { display: 'flex', height: '100vh', overflow: 'hidden' },
  sidebar: { width: 220, background: '#1a3a5c', color: 'white', display: 'flex', flexDirection: 'column' },
  logo: { padding: '1.5rem 1rem', fontSize: '1.1rem', fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.1)' },
  navBtn: { display: 'block', width: '100%', textAlign: 'left', padding: '0.75rem 1rem', background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', fontSize: '0.9rem' },
  navBtnActive: { background: 'rgba(255,255,255,0.15)' },
  content: { flex: 1, overflow: 'auto', padding: '1.5rem' },
};

export function App() {
  const [page, setPage] = useState<Page>('permits');

  return (
    <div style={styles.shell}>
      <div style={styles.sidebar}>
        <div style={styles.logo}>🏗 Permit Intel</div>
        {NAV.map((n) => (
          <button
            key={n.key}
            style={{ ...styles.navBtn, ...(page === n.key ? styles.navBtnActive : {}) }}
            onClick={() => setPage(n.key)}
          >
            {n.label}
          </button>
        ))}
      </div>
      <div style={styles.content}>
        {page === 'permits' && <PermitList />}
        {page === 'reports' && <ReportQueue />}
        {page === 'entities' && <EntityReview />}
        {page === 'exports' && <ExportPage />}
      </div>
    </div>
  );
}
