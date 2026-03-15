// Runtime config — never baked into the build bundle.
// Falls back to VITE_DEFAULT_WORKER_URL env var (set in Pages) or localhost.
function getConfig() {
  const url =
    localStorage.getItem('workerUrl') ||
    (import.meta as any).env?.VITE_DEFAULT_WORKER_URL ||
    'http://localhost:8787';
  const key = localStorage.getItem('apiKey') || '';
  return { url: url.replace(/\/$/, ''), key };
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const { url, key } = getConfig();
  const resp = await fetch(`${url}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      ...(opts.headers ?? {}),
    },
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`API ${resp.status}: ${body.slice(0, 200)}`);
  }
  return resp.json();
}

export const api = {
  permits: {
    list: (params: Record<string, string> = {}) => {
      const qs = new URLSearchParams(params).toString();
      return request<{ permits: unknown[] }>(`/api/permits${qs ? `?${qs}` : ''}`);
    },
    get: (id: string) => request<{ permit: unknown }>(`/api/permits/${id}`),
    updateStatus: (id: string, status: string) =>
      request(`/api/permits/${id}`, { method: 'PUT', body: JSON.stringify({ status }) }),
  },
  reports: {
    list: () => request<{ reports: unknown[] }>('/api/reports'),
    get: (id: string) => request<{ report: unknown }>(`/api/reports/${id}`),
    create: (permitId: string) =>
      request<{ report: unknown }>('/api/reports', {
        method: 'POST',
        body: JSON.stringify({ permit_id: permitId }),
      }),
    run: (reportId: string) =>
      request<{ report_version: unknown }>(`/api/reports/${reportId}/run`, { method: 'POST' }),
    stages: (reportId: string) =>
      request<{ stages: unknown[] }>(`/api/reports/${reportId}/stages`),
  },
  entities: {
    suggestions: () => request<{ suggestions: unknown[] }>('/api/entities'),
    merge: (winnerId: string, mergedId: string) =>
      request('/api/entities/merge', {
        method: 'POST',
        body: JSON.stringify({ winner_id: winnerId, merged_id: mergedId }),
      }),
    unmerge: (mergeLedgerId: string, note?: string) =>
      request('/api/entities/unmerge', {
        method: 'POST',
        body: JSON.stringify({ merge_ledger_id: mergeLedgerId, note }),
      }),
  },
  exports: {
    create: (reportId: string, reportVersionId: string) =>
      request<{ export_id: string }>('/api/exports', {
        method: 'POST',
        body: JSON.stringify({ report_id: reportId, report_version_id: reportVersionId }),
      }),
    get: (id: string) => request<{ export: unknown }>(`/api/exports/${id}`),
    // ?key= is accepted by the worker ONLY for this specific path
    htmlUrl: (id: string) => {
      const { url, key } = getConfig();
      return `${url}/api/exports/${id}/html?key=${encodeURIComponent(key)}`;
    },
  },
};
