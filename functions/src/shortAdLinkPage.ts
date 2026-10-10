export interface TrackedAdLink { source: string; campaign?: string; gameId?: string; shortCode: string }
export function shortCodeFromPath(path: string): string | null {
  const match = /^\/play\/([A-Za-z0-9]{8})\/?$/.exec(path);
  return match?.[1] ?? null;
}
export function readTrackedAdLink(data: Record<string, unknown> | undefined, code: string): TrackedAdLink | null {
  if (!data || data.shortCode !== code || typeof data.source !== 'string' || !data.source.trim()) return null;
  return { source: data.source.trim(), shortCode: code,
    ...(typeof data.campaign === 'string' && data.campaign ? { campaign: data.campaign } : {}),
    ...(typeof data.gameId === 'string' && data.gameId ? { gameId: data.gameId } : {}) };
}
export function renderTrackedAdLink(template: string, link: TrackedAdLink): string {
  // A custom campaign name can contain HTML. Never let it close the script tag.
  const context = JSON.stringify({ type: 'go', source: link.source, campaign: link.campaign || '',
    gameTarget: link.gameId || '', linkId: link.shortCode })
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return template.replace('</head>', `<script>window.__INVITE__=${context};</script></head>`);
}
