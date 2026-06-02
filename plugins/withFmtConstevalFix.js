// withFmtConstevalFix — works around a build break between the `fmt`
// pod (pinned transitively by React Native, v11.0.2) and the stricter
// `consteval` evaluation in the clang shipped with Xcode 16 / 26.
//
// fmt's FMT_STRING(...) macro is evaluated through a `consteval`
// constructor; the newer compiler rejects it as "not a constant
// expression", failing the build with errors in fmt/format-inl.h.
//
// fmt picks `consteval` via the FMT_USE_CONSTEVAL macro, which base.h
// defines UNCONDITIONALLY (not behind an `#ifndef`), so passing
// `-DFMT_USE_CONSTEVAL=0` doesn't stick — base.h re-defines it to 1.
// We therefore patch base.h's text to force the macro to 0 (which
// makes fmt fall back to plain `constexpr` — fully functional, just
// less compile-time strictness). The patch is injected into the
// Podfile's post_install hook so it re-applies on every clean
// prebuild / `pod install`, AFTER the fmt sources land on disk.

const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod } = require('expo/config-plugins');

const MARKER = 'withFmtConstevalFix';
const RUBY_SNIPPET = `
    # --- ${MARKER}: disable fmt consteval for Xcode 16/26 clang ---
    fmt_base = File.join(__dir__, 'Pods', 'fmt', 'include', 'fmt', 'base.h')
    if File.exist?(fmt_base)
      txt = File.read(fmt_base)
      patched = txt.gsub('#  define FMT_USE_CONSTEVAL 1', '#  define FMT_USE_CONSTEVAL 0')
      File.write(fmt_base, patched) if txt != patched
    end
    # --- end ${MARKER} ---
`;

function withFmtConstevalFix(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfile = path.join(
        cfg.modRequest.platformProjectRoot,
        'Podfile',
      );
      if (fs.existsSync(podfile)) {
        let txt = fs.readFileSync(podfile, 'utf8');
        if (!txt.includes(MARKER)) {
          txt = txt.replace(
            /post_install do \|installer\|\n/,
            (m) => m + RUBY_SNIPPET,
          );
          fs.writeFileSync(podfile, txt);
        }
      }
      return cfg;
    },
  ]);
}

module.exports = withFmtConstevalFix;
