/**
 * Teamder watch complication (WidgetKit) — a face shortcut that opens the watch
 * app. Injected alongside the watch app by @bacons/apple-targets.
 *
 * NOTE: showing LIVE data (a ticking timer / next-game text) on the complication
 * needs an App Group shared between the watch app and this widget, where the
 * watch app writes the latest state and the widget reads + reloads it. That's
 * the next iteration; v1 is a launcher.
 *
 * @type {import('@bacons/apple-targets').Config}
 */
module.exports = {
  type: 'watch-widget',
  deploymentTarget: '9.4',
  bundleIdentifier: 'com.studiogameslime.soccerapp.watchkitapp.complication',
  frameworks: ['WidgetKit', 'SwiftUI'],
};
