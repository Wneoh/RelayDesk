import { useSyncExternalStore } from 'react';
export type View =
  'overview' | 'inbox' | 'review' | 'agents' | 'knowledge' | 'rules' | 'analytics' | 'team';
export const viewPaths: Record<View, string> = {
  overview: '/',
  inbox: '/tickets',
  review: '/review',
  agents: '/agents',
  knowledge: '/knowledge',
  rules: '/rules',
  analytics: '/performance',
  team: '/team',
};
function subscribe(notify: () => void) {
  window.addEventListener('popstate', notify);
  window.addEventListener('relaydesk:route', notify);
  return () => {
    window.removeEventListener('popstate', notify);
    window.removeEventListener('relaydesk:route', notify);
  };
}
export function goRoute(path: string, replace = false) {
  if (path === window.location.pathname + window.location.search) return;
  window.history[replace ? 'replaceState' : 'pushState']({}, '', path);
  window.dispatchEvent(new Event('relaydesk:route'));
}
export function readRoute() {
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  const match = path.match(
    /^\/tickets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
  );
  const view = Object.entries(viewPaths).find(([, p]) => p === path)?.[0] as View | undefined;
  return {
    location: window.location.pathname + window.location.search,
    view: view || ('inbox' as View),
    ticketId: match?.[1] || null,
    notFound: !view && !match,
  };
}
export function useRoute() {
  useSyncExternalStore(subscribe, () => window.location.pathname + window.location.search);
  return readRoute();
}
