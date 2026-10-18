// Defense in depth for the legacy error channel. The structured action journal
// has its own allowlist; do not replace it with a dump of arbitrary context.
const HIDDEN = '[redacted]';
const PRIVATE_KEY = /(?:password|passwd|secret|token|credential|authorization|cookie|email|phone|mobile|privatekey|clientsecret)/i;

export function redactDiagnosticText(text: string): string {
  return text
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, HIDDEN)
    .replace(/\bBearer\s+[^\s,;"']+/gi, `Bearer ${HIDDEN}`)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, HIDDEN)
    .replace(/([?&#])([^=\s&#]+)=([^\s&#]*)/g, (all, separator: string, key: string, value: string) => {
      let decodedKey = key, decodedValue = value;
      try { decodedKey = decodeURIComponent(key); decodedValue = decodeURIComponent(value); } catch { /* redact raw values too */ }
      return PRIVATE_KEY.test(decodedKey) || /[^\s@]+@[^\s@]+\.[^\s@]+/.test(decodedValue)
        ? `${separator}${key}=${HIDDEN}` : all;
    })
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, HIDDEN)
    .replace(/\+\d[\d ().-]{7,}\d/g, HIDDEN)
    .replace(/\b05\d[- .]?\d{3}[- .]?\d{4}\b/g, HIDDEN)
    .replace(/\b(password|passwd|secret|token|authorization|cookie|credential)\s*[:=]\s*[^\s,;"'}]+/gi, `$1=${HIDDEN}`);
}

/** Bounded, cycle-safe and JSON-safe; preserve ids and state needed to reproduce. */
export function redactDiagnosticContext(input: unknown): Record<string, unknown> {
  const seen = new Set<object>();
  let budget = 3500;
  const visit = (value: unknown, depth: number): unknown => {
    if (budget <= 0 || depth > 5) return undefined;
    if (typeof value === 'string') {
      const text = redactDiagnosticText(value).slice(0, Math.min(1500, budget));
      budget -= text.length;
      return text;
    }
    if (value === null || typeof value === 'boolean') { budget -= 5; return value; }
    if (typeof value === 'number') { budget -= 24; return Number.isFinite(value) ? value : undefined; }
    if (typeof value !== 'object' || seen.has(value)) return undefined;
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 20).map(v => visit(v, depth + 1)).filter(v => v !== undefined);
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, 40)) {
      if (budget <= 0) break;
      if (key.length > 100 || ['__proto__', 'constructor', 'prototype'].includes(key)) continue;
      budget -= key.length + 8;
      const clean = PRIVATE_KEY.test(key) ? HIDDEN : visit(item, depth + 1);
      if (clean !== undefined) result[key] = clean;
    }
    return result;
  };
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    const result = visit(input, 0) as Record<string, unknown>;
    // JSON escaping can expand strings after the traversal's character budget.
    while (JSON.stringify(result).length > 4000) delete result[Object.keys(result).at(-1)!];
    return result;
  } catch { return {}; }
}
