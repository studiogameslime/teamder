/** JSON embedded in an HTML script must also escape the HTML parser boundary. */
export function mapScriptValue(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function validMapPoint(point: {lat: unknown; lng: unknown}): point is {lat: number; lng: number} {
  return typeof point.lat === 'number' && Number.isFinite(point.lat) && Math.abs(point.lat) <= 90
    && typeof point.lng === 'number' && Number.isFinite(point.lng) && Math.abs(point.lng) <= 180;
}

/** Keep the inline document; map tiles/scripts are subresources, not navigation. */
export function allowMapNavigation(url: string): boolean {
  return url === 'about:blank' || url.startsWith('about:blank#') || /^data:text\/html(?:;|,)/i.test(url);
}
