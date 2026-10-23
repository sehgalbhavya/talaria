import { useEffect, useState } from 'react';

export type View = 'board' | 'summary' | 'archive' | 'profile' | 'activity' | 'settings';
const VIEWS: View[] = ['board', 'summary', 'archive', 'profile', 'activity', 'settings'];

export interface Route {
  view: View;
  jobId: string | null;
  tab: string | null;
}

function parse(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = h.split('?');
  const params = new URLSearchParams(query);
  const view = (VIEWS.includes(path as View) ? path : 'board') as View;
  return { view, jobId: params.get('job'), tab: params.get('tab') };
}

function build(r: Route) {
  const params = new URLSearchParams();
  if (r.jobId) params.set('job', r.jobId);
  if (r.jobId && r.tab) params.set('tab', r.tab);
  const q = params.toString();
  return `#/${r.view}${q ? `?${q}` : ''}`;
}

export function navigate(patch: Partial<Route>, replace = false) {
  const next = { ...parse(), ...patch };
  if (patch.view && patch.jobId === undefined) next.jobId = null;
  const url = build(next);
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export const openJob = (id: string, tab?: string) => navigate({ jobId: id, tab: tab ?? null });
export const closeJob = () => navigate({ jobId: null, tab: null });

export function useRoute(): Route {
  const [r, setR] = useState(parse);
  useEffect(() => {
    const on = () => setR(parse());
    window.addEventListener('hashchange', on);
    window.addEventListener('popstate', on);
    return () => {
      window.removeEventListener('hashchange', on);
      window.removeEventListener('popstate', on);
    };
  }, []);
  return r;
}
