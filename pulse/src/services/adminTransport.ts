import { pulseAdminRequest } from './adminSession';
import { toByteArray } from 'base64-js';

/** Compatibility transport. Provider credentials never cross into the app. */
export async function pulseFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (init.body !== undefined && typeof init.body !== 'string') throw new Error('Unsupported administrative body');
  const result = await pulseAdminRequest({ url, method: init.method ?? 'GET', ...(init.body !== undefined ? { body: init.body } : {}) });
  const bytes = result.encoding === 'base64' ? toByteArray(result.body) : new TextEncoder().encode(result.body ?? '');
  // Native Response keeps the existing JSON/text/arrayBuffer consumers intact.
  return new Response(result.status === 204 ? null : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { status: result.status, headers: { 'Content-Type': result.contentType ?? 'application/json' } });
}
