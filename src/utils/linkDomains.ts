/** Canonical origin for newly shared links. Keep old hosts for incoming links. */
export const PUBLIC_LINK_ORIGIN = 'https://teamder.co.il';

export const HOSTING_DOMAINS = new Set([
  'teamder.co.il',
  'www.teamder.co.il',
  'teamderfc.web.app',
  'teamderfc.firebaseapp.com',
  'teamder.web.app',
  'teamder.firebaseapp.com',
]);

/** Only hosts that actually serve the invite-code resolver. */
export const SHORT_LINK_DOMAINS = new Set([
  'teamder.co.il',
  'www.teamder.co.il',
  'teamderfc.web.app',
  'teamderfc.firebaseapp.com',
]);
