const BASE_URL = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:8787';
const API_KEY = (import.meta as any).env?.VITE_API_KEY ?? 'dev-key';

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const resp = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
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
      request<{ report: unknown }>('/api/reports', { method: 'POST', body: JSON.stringify({ permit_id: permitId }) }),
    run: (reportId: string) =>
      request<{ report_version: unknown }>(`/api/reports/${reportId}/run`, { method: 'POST' }),
    stages: (reportId: string) =>
      request<{ stages: unknown[] }>(`/api/reports/${reportId}/stages`),
  },
  entities: {
    suggestions: () => request<{ suggestions: unknown[] }>('/api/entities'),
    merge: (winnerId: string, mergedId: string) =>
      request('/api/entities/merge', { method: 'POST', body: JSON.stringify({ winner_id: winnerId, merged_id: mergedId }) }),
    unmerge: (mergeLedgerId: string, note?: string) =>
      request('/api/entities/unmerge', { method: 'POST', body: JSON.stringify({ merge_ledger_id: mergeLedgerId, note }) }),
  },
  exports: {
    create: (reportId: string, reportVersionId: string) =>
      request<{ export_id: string }>('/api/exports', {
        method: 'POST',
        body: JSON.stringify({ report_id: reportId, report_version_id: reportVersionId }),
      }),
    get: (id: string) => request<{ export: unknown }>(`/api/exports/${id}`),
    htmlUrl: (id: string) => `${BASE_URL}/api/exports/${id}/html`,
  },
};
