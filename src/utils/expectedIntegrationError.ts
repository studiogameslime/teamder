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

/** Play temporarily refuses installation because of device state. */
export function isPlayInstallNotAllowed(error: unknown): boolean {
 const value = error as {code?:unknown;message?:unknown}|null;
 return value?.code === 'ERROR_INSTALL_NOT_ALLOWED' || /\bERROR_INSTALL_NOT_ALLOWED\b|Install Error\(-6\)/.test(String(value?.message ?? error));
}

export function isMissingLinkHandler(error: unknown): boolean {
  return /No Activity found to handle Intent|No application can handle|Unable to open URL/i.test(String((error as {message?:unknown}|null)?.message ?? error));
}
