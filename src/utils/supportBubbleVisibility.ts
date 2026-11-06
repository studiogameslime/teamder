// Keep the floating launcher on tab roots, clear of secondary work surfaces.
// This controls only the bubble; the mounted support host keeps its draft
// and can still open from the existing menu/header entry points.
const ROUTES_WITH_SUPPORT_BUBBLE = new Set([
  'Profile',
  'CommunitiesFeed',
  'GamesList',
  'ChatsList',
  'GuestHome',
]);

export function shouldHideSupportBubble(routeName?: string | null): boolean {
  return typeof routeName !== 'string' || !ROUTES_WITH_SUPPORT_BUBBLE.has(routeName);
}
