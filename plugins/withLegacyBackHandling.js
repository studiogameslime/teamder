// Opt out of Android's predictive back, so the back button works again.
//
// Android 16 turns the predictive-back system ON BY DEFAULT for any app that
// targets API 36. Under it, a back press is delivered through
// OnBackInvokedCallback instead of the legacy onBackPressed — and React
// Native's BackHandler, which is what React Navigation itself listens on,
// only knows about the legacy path. So nothing in JS ever hears the press,
// and Android's default takes over: finish the activity, close the app.
//
// The symptom is total. Reproduced on an API 36 emulator: back from a nested
// screen ("פרטי מחזור") closed the app instead of popping it, and back from a
// tab closed it instead of returning home. Every back press in the app, gone.
//
// The cause was our own targetSdk bump. Google raised the Play floor mid-
// release and 1.1.3 moved from 35 to 36 to satisfy it; nothing else changed,
// and this came along uninvited.
//
// `android:enableOnBackInvokedCallback="false"` restores the legacy delivery,
// which is exactly what the app was built against. The alternative — adopting
// predictive back properly — is a React Native and React Navigation upgrade
// with animation work behind it, and is not something to attempt in the same
// breath as fixing a completely broken back button.
//
// Revisit when React Navigation supports predictive back end to end; until
// then this flag is what keeps back working at all.

const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withLegacyBackHandling(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults?.manifest?.application?.[0];
    if (!app) return cfg;
    app.$ = app.$ || {};
    app.$['android:enableOnBackInvokedCallback'] = 'false';
    return cfg;
  });
};
