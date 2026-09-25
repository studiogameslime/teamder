// Podfile post_install patches for newer Xcode toolchains.
//
// The file is still named for its first patch, and stays registered in
// app.json under that name so nothing has to be rewired. It now carries TWO
// independent workarounds, each with its own marker so neither can be
// injected twice and neither can clobber the other.
//
// ─── 1. fmt consteval (Xcode 16 / 26) ────────────────────────────────────
//
// The `fmt` pod (pinned transitively by React Native, v11.0.2) breaks against
// the stricter `consteval` evaluation in newer clang: FMT_STRING(...) is
// evaluated through a `consteval` constructor and the compiler rejects it as
// "not a constant expression", failing in fmt/format-inl.h.
//
// fmt picks `consteval` via FMT_USE_CONSTEVAL, which base.h defines
// UNCONDITIONALLY (not behind an `#ifndef`), so `-DFMT_USE_CONSTEVAL=0` does
// not stick. We patch base.h's text instead, which makes fmt fall back to
// plain `constexpr` — fully functional, just less compile-time strictness.
//
// ─── 2. Pods deployment target (Xcode 27) ────────────────────────────────
//
// Xcode 27 raised the minimum iOS deployment target from 12.0 to 15.0 and
// made a target below it a hard ERROR rather than a warning. Fourteen pod
// sub-targets — resource bundles and the privacy bundles the App Store now
// requires — inherit their minimum from the POD'S OWN podspec (9.0 … 13.4)
// rather than from `platform :ios` in the Podfile, so the build failed with
// fourteen copies of:
//
//   error: The iOS Simulator deployment target 'IPHONEOS_DEPLOYMENT_TARGET'
//   is set to 12.0, but the range of supported deployment target versions
//   is 15.0 to 27.0.x
//
// 15.1 is not a new floor: the Teamder target and `platform :ios` are both
// already 15.1. This only stops the generated sub-targets from claiming
// support for systems the app itself has never supported.
//
// It runs AFTER `react_native_post_install`, deliberately — that helper walks
// the same targets and would otherwise write its values on top of ours.
//
// Both patches are injected into the Podfile's post_install hook so they
// re-apply on every clean prebuild / `pod install`.

const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod } = require('expo/config-plugins');

/** The floor the app itself already declares. Not a new minimum. */
const IOS_DEPLOYMENT_TARGET = '15.1';

const FMT_MARKER = 'withFmtConstevalFix';
const FMT_SNIPPET = `
    # --- ${FMT_MARKER}: disable fmt consteval for Xcode 16/26 clang ---
    fmt_base = File.join(__dir__, 'Pods', 'fmt', 'include', 'fmt', 'base.h')
    if File.exist?(fmt_base)
      txt = File.read(fmt_base)
      patched = txt.gsub('#  define FMT_USE_CONSTEVAL 1', '#  define FMT_USE_CONSTEVAL 0')
      File.write(fmt_base, patched) if txt != patched
    end
    # --- end ${FMT_MARKER} ---
`;

const DEPLOYMENT_MARKER = 'withPodsDeploymentTarget';
const DEPLOYMENT_SNIPPET = `
    # --- ${DEPLOYMENT_MARKER}: Xcode 27 rejects pod targets below iOS 15.0 ---
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |bc|
        bc.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${IOS_DEPLOYMENT_TARGET}'
      end
    end
    # --- end ${DEPLOYMENT_MARKER} ---
`;

/**
 * Put a Ruby snippet into the Podfile once.
 *
 * `anchor` is matched and the snippet appended immediately after it, so a
 * caller can choose whether the patch runs at the top of post_install or
 * after something else that would otherwise overwrite it. The marker makes
 * this idempotent: prebuild and `pod install` both re-run the plugin, and a
 * second copy of either loop would be silently wasteful at best.
 */
function injectOnce(text, marker, snippet, anchor) {
  if (text.includes(marker)) return text;
  const m = text.match(anchor);
  if (!m) return text;
  return text.replace(anchor, (hit) => hit + snippet);
}

function withPodfilePatches(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      if (fs.existsSync(podfile)) {
        let txt = fs.readFileSync(podfile, 'utf8');
        const before = txt;

        // Top of post_install: patches a file on disk, order does not matter.
        txt = injectOnce(txt, FMT_MARKER, FMT_SNIPPET, /post_install do \|installer\|\n/);

        // After react_native_post_install(...): this one writes BUILD SETTINGS,
        // and that helper rewrites the same targets. Going first would lose.
        txt = injectOnce(
          txt,
          DEPLOYMENT_MARKER,
          DEPLOYMENT_SNIPPET,
          /react_native_post_install\([\s\S]*?\n {4}\)\n/,
        );

        if (txt !== before) fs.writeFileSync(podfile, txt);
      }
      return cfg;
    },
  ]);
}

module.exports = withPodfilePatches;
