// What this dashboard monitors. Edit these to point at any app you own.
// Nothing here is secret — the actual API keys live in src/secrets.ts.

export const config = {
  // Friendly name shown in the UI + notifications.
  appName: 'Teamder',

  // ── Apple App Store ──────────────────────────────────────────────
  appStore: {
    // Numeric App Store ID (from the App Store / ASC URL).
    appId: '6775178022',
    // Vendor number (ASC → Business / Payments) — for Sales Reports.
    vendorNumber: '94396203',
  },

  // ── Google Play ──────────────────────────────────────────────────
  googlePlay: {
    packageName: 'com.studiogameslime.soccerapp',
    // Play statistics reports bucket (Play Console → Download reports).
    statsBucket: 'pubsite_prod_7409752960104322940',
  },

  // ── AdMob ────────────────────────────────────────────────────────
  admob: {
    // Optional. Leave blank to auto-resolve the first account on the
    // signed-in AdMob user (accounts/pub-XXXXXXXXXXXXXXXX).
    publisherId: '',
  },

  // ── Google Analytics (GA4 / Firebase Analytics) ──────────────────
  analytics: {
    // GA4 numeric property ID (Admin → Property Settings).
    propertyId: '534662166',
  },

  // ── Firebase / Firestore (app's own data: users, games, groups) ──
  firebase: {
    projectId: 'soccer-app-52b6b',
  },

  // How often the background task polls for new reviews (minutes).
  // Android enforces a ~15 min floor regardless of lower values.
  pollIntervalMinutes: 20,
};

/**
 * Force the mock work list on, even when Firebase credentials exist.
 *
 * The משימות screen also falls back to the fixture automatically when there
 * are no credentials — this flag is for the other case: seeing a state that
 * production has not produced yet. "בוצע ע״י קלוד" is the one that needs it,
 * because it cannot exist until Claude has finished something, which makes it
 * impossible to review or screenshot while building the feature.
 *
 * Leave FALSE. Flip it, look, flip it back.
 */
export const MOCK_WORK = false;
