// Tiny helper that opens a wa.me deep link for a community contact phone.
// Israeli-aware: normalises 05XXXXXXXX → 9725XXXXXXXX (the country-code
// expanded form wa.me requires). +9725XXXXXXXX and any other E.164 input
// pass through (the leading + is dropped because wa.me doesn't accept it).
//
// `isValidIsraeliPhone` exposes the same validation rule the UI uses to
// hide / show the WhatsApp button so we don't lead users into a 404.

import { Linking } from 'react-native';

/**
 * Returns true for the two formats we accept on input:
 *   05XXXXXXXX           — local Israeli mobile, 10 digits
 *   +9725XXXXXXXX        — international form, 13 chars including the +
 * Anything else (landline, foreign, partial) returns false.
 */
export function isValidIsraeliPhone(phone: string | undefined): boolean {
  if (!phone) return false;
  const compact = phone.replace(/[\s-]/g, '');
  return /^(05\d{8}|\+9725\d{8})$/.test(compact);
}

/**
 * Returns the wa.me-friendly digits-only string, or null if the input
 * isn't a recognized Israeli mobile.
 */
export function normalizeIsraeliPhone(phone: string | undefined): string | null {
  if (!phone) return null;
  const compact = phone.replace(/[\s-]/g, '');
  if (/^05\d{8}$/.test(compact)) {
    return '972' + compact.slice(1); // strip leading 0, prepend 972
  }
  if (/^\+9725\d{8}$/.test(compact)) {
    return compact.slice(1); // drop the leading +
  }
  return null;
}

/**
 * Best-effort: open https://wa.me/<digits>. Returns true if the OS at
 * least accepted the URL (it doesn't guarantee WhatsApp launched).
 * Returns false if the phone is invalid or Linking refused.
 */
export async function openWhatsApp(phone: string | undefined): Promise<boolean> {
  const digits = normalizeIsraeliPhone(phone);
  if (!digits) return false;
  const url = `https://wa.me/${digits}`;
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
