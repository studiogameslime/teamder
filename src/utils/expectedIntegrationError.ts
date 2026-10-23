/** Narrow absence-of-capability cases; unrelated bridge failures stay reportable. */
export function isWearableApiUnavailable(error: unknown): boolean {
  const message = String((error as { message?: unknown } | null)?.message ?? error);
  return message.includes('Wearable.API') &&
    /\b(?:API_UNAVAILABLE|API: Wearable\.API is not available on this device)\b/.test(message);
}

export function isPlayAppNotOwned(error: unknown): boolean {
  const value = error as { code?: unknown; message?: unknown } | null;
  if (value?.code === 'ERROR_APP_NOT_OWNED') return true;
  const message = String(value?.message ?? error);
  return /\bERROR_APP_NOT_OWNED\b/.test(message) ||
    /Install Error\(-10\)/.test(message);
}
