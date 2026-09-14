// Classifying sign-in failures by WHOSE problem they are.
//
// The error panel is only useful if everything in it is something we can fix.
// A device that refuses to open a browser is not: Google reports it as
// "Unable to open Safari" with code -1, and it means Safari has been disabled
// on that iPhone — Screen Time content limits, or a management profile.
//
// Production took 13 of these, six of them one person retrying inside three
// minutes, while our OAuth wiring was verified correct (the iosUrlScheme in
// app.json matches the REVERSED_CLIENT_ID in GoogleService-Info.plist). So it
// is not a bug to file — but it IS something the user can act on, and the
// generic "sign-in failed" told them nothing.

/**
 * Google could not hand off to a browser, because this device has none to give.
 *
 * Matched on Google's own wording rather than on its code: the code that comes
 * with it (-1, "Unknown error in google sign in") is a catch-all, and treating
 * every -1 this way would hide real failures behind advice about Screen Time.
 */
export function isBrowserBlocked(err: unknown): boolean {
  const e = err as { message?: string };
  return /unable to open (safari|url|browser)/i.test(String(e?.message ?? ''));
}
