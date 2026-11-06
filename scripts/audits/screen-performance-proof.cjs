// Render production JSX with explicit browser adapters. This verifies the
// source regions/RTL, not native layouts, network latency or device startup.
const fs = require('fs'), path = require('path'), ts = require('typescript');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const { pathToFileURL } = require('url');
const out = path.resolve('artifacts/performance-2026-11-04');
fs.mkdirSync(out, { recursive: true });
const noop = () => {};
const flat = value => !value ? {} : Array.isArray(value) ? Object.assign({}, ...value.map(flat)) : typeof value === 'function' ? flat(value({ pressed: false })) : value;
function css(style) {
  return Object.fromEntries(Object.entries(flat(style)).flatMap(([key, value]) => {
    if (value == null || key === 'elevation' || key.startsWith('shadow') || key === 'transform') return [];
    if (/^(padding|margin)(Horizontal|Vertical)$/.test(key)) {
      const prefix = key.startsWith('padding') ? 'padding' : 'margin';
      return (key.endsWith('Horizontal') ? ['Left', 'Right'] : ['Top', 'Bottom']).map(suffix => [prefix + suffix, value]);
    }
    return [[key, key === 'fontFamily' ? 'Arial' : key === 'textAlign' && value === 'left' ? 'right' : key === 'lineHeight' ? `${value}px` : value]];
  }));
}
const primitive = (tag, defaults = {}) => ({ children, style, accessibilityLabel, accessibilityRole }) => React.createElement(tag, {
  style: { boxSizing: 'border-box', borderWidth: 0, borderStyle: 'solid', ...defaults, ...css(style) },
  'aria-label': accessibilityLabel, role: accessibilityRole,
}, children);
const View = primitive('div', { display: 'flex', flexDirection: 'column', position: 'relative', minWidth: 0, flexShrink: 0 });
const Text = primitive('span', { fontFamily: 'Arial', whiteSpace: 'pre-wrap' });
const Icon = ({ size = 18 }) => React.createElement(View, { style: { width: size, height: size, borderRadius: 5, backgroundColor: '#D1DDEB', flexShrink: 0 } });
const RN = { View, Text, Pressable: View, ScrollView: View, StyleSheet: { create: x => x, hairlineWidth: 1, absoluteFillObject: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } }, Appearance: { getColorScheme: () => 'light' } };
let phase, cache, theme;
function read(file) {
  const prior = path.join(out, 'before-src', path.relative(process.cwd(), path.resolve(file)));
  return fs.readFileSync(phase === 'before' && fs.existsSync(prior) ? prior : file, 'utf8');
}
const reanimated = { __esModule: true, default: { View }, useSharedValue: x => ({ value: x }), useAnimatedStyle: fn => fn(),
  cancelAnimation: noop, withRepeat: x => x, withTiming: x => x, Easing: { inOut: noop, out: noop, quad: noop, cubic: noop, linear: noop } };
function load(file) {
  file = path.resolve(file); if (cache[file]) return cache[file].exports;
  const module = { exports: {} }; cache[file] = module;
  const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'react') return React;
    if (name === 'react-native') return RN;
    if (name === 'react-native-reanimated') return reanimated;
    if (name === '@expo/vector-icons') return { Ionicons: Icon };
    if (name === '@/theme') return theme;
    if (name === '@/hooks/animations/useReducedMotion') return { useReducedMotion: () => true };
    if (name.endsWith('/StatisticsIllustration')) return { StatisticsIllustration: Icon };
    const base = name.startsWith('@/') ? path.resolve('src', name.slice(2)) : path.resolve(path.dirname(file), name);
    return load([base, base + '.ts', base + '.tsx', path.join(base, 'index.ts')].find(p => fs.existsSync(p) && fs.statSync(p).isFile()) || base);
  }, module, module.exports);
  return module.exports;
}
function source(file) { return ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); }
function find(tree, predicate) {
  let match; const visit = node => { if (!match && predicate(node)) match = node; ts.forEachChild(node, visit); }; visit(tree);
  if (!match) throw Error('Source region missing in ' + tree.fileName); return match;
}
function evaluate(node, tree, context) {
  const code = ts.transpileModule('const result = ' + node.getText(tree).replace(/^export\s+/, ''), { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function('React', ...Object.keys(context), code + ';return result;')(React, ...Object.values(context));
}
function styles(tree, context = {}) {
  return evaluate(find(tree, n => ts.isVariableDeclaration(n) && n.name.getText(tree) === 'styles').initializer, tree, { StyleSheet: RN.StyleSheet, ...theme, ...context });
}
const scenes = [];
function save(id, title, body, nativeHeight = false) {
  const filename = `${id}-${phase}.html`;
  fs.writeFileSync(path.join(out, filename), `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><style>body{margin:0;background:#F4F7FB;color:#15244F;font-family:Arial}header{background:white;font-size:21px;font-weight:bold;padding:16px}.fixture{font-size:11px;color:#64748B;padding:8px 16px}main{display:flex;flex-direction:column;position:relative;min-height:800px;${nativeHeight ? 'height:844px;' : 'padding:16px;'}}*{box-sizing:border-box}</style><header>${title}</header><div class="fixture">אזור מקור עם נתוני הדגמה ומתאמי דפדפן</div><main>${renderToStaticMarkup(body)}</main></html>`);
  scenes.push({ id, phase, filename });
}
for (phase of ['before', 'after']) {
  cache = {}; theme = { RTL_LABEL_ALIGN: 'left', ...load('src/theme/colors.ts'), ...load('src/theme/spacing.ts'), ...load('src/theme/typography.ts'), ...load('src/theme/clubAccents.ts') };
  const loaders = load('src/components/loading/ScreenSkeletons.tsx');
  const draft = source('src/screens/games/DraftSetupScreen.tsx');
  const gate = find(draft, n => ts.isIfStatement(n) && n.expression.getText(draft).startsWith('loadingGame ||'));
  save('draft', 'חלוקת כוחות', evaluate(gate.thenStatement.expression, draft, {
    styles: styles(draft), SafeAreaView: View, View, Text, ScrollView: View,
    ScreenHeader: ({ title }) => React.createElement(Text, { style: { padding: 16, fontSize: 22, fontWeight: '700' } }, title),
    he: { draftTitle: 'חלוקת כוחות' }, colors: theme.colors, loadFailed: false,
    ActivityIndicator: () => React.createElement(View, { style: { width: 26, height: 26, borderWidth: 3, borderColor: '#CADAF6', borderTopColor: '#2467F4', borderRadius: 20 } }),
    DraftSetupSkeleton: load('src/components/loading/DraftSetupSkeleton.tsx').DraftSetupSkeleton,
  }));
  const roster = source('src/screens/communities/CommunityPlayersScreen.tsx');
  const row = find(roster, n => ts.isFunctionDeclaration(n) && n.name?.text === 'PlayerRow');
  const PlayerRow = evaluate(row, roster, { View, Text, Pressable: View, styles: styles(roster), colors: theme.colors,
    UserAvatar: ({ user, size }) => React.createElement(View, { style: { width: size, height: size, borderRadius: size / 2, backgroundColor: '#DDE9FB', alignItems: 'center', justifyContent: 'center' } }, React.createElement(Text, null, user.name[0])),
    Ionicons: Icon, CardCountBadges: () => null, he: { communityDetailsAdminBadge: 'מנהל' } });
  save('roster', 'שחקני המועדון', phase === 'before' ? React.createElement(loaders.PlayersSkeleton) : React.createElement(React.Fragment, null,
    React.createElement(loaders.LoadingNotice, { compact: true, label: 'מעדכנים את רשימת השחקנים' }),
    ...['איתי ישראלי', 'יואב כהן', 'אור לוי'].map((name, i) => React.createElement(PlayerRow, { key: name, user: { name }, isAdmin: i === 0, showDivider: i > 0, onOpenMenu: noop }))));
  const overview = phase === 'before' ? React.createElement(loaders.PersonalStatsSkeleton) : React.createElement(load('src/components/home/HomeProfileOverview.tsx').HomeProfileOverview, {
    stats: { attendedGames: 8, totalRegistered: 10, goals: 12, assists: 7, attendanceRate: 80, distinctPlayers: 24, goalsPerEvening: 1.5 }, playerId: 'fixture', onProfile: noop, onStatistics: noop,
  });
  save('home', 'הבית שלי', React.createElement(View, { style: { padding: 16, minHeight: 318, backgroundColor: 'white', borderRadius: 21 } }, overview));
  const splash = source('src/screens/SplashScreen.tsx');
  const visual = find(splash, n => ts.isFunctionDeclaration(n) && n.name?.text === 'SplashVisual');
  const imageFile = /require\(['"]([^'"]+\.(?:png|jpg))/.exec(fs.readFileSync('src/components/entry/SplashHero.tsx', 'utf8'))[1];
  const splashPath = imageFile.startsWith('@/') ? path.resolve('src', imageFile.slice(2)) : path.resolve('src/components/entry', imageFile);
  const imageData = 'data:image/png;base64,' + fs.readFileSync(splashPath).toString('base64');
  const splashConstants = Object.fromEntries([...read('src/screens/SplashScreen.tsx').matchAll(/^const ([A-Z_]+) = (\d+);/gm)].map(m => [m[1], Number(m[2])]));
  const SplashVisual = evaluate(visual, splash, { View, SafeAreaView: View, Image: ({ style }) => React.createElement('img', { src: imageData, style: { ...css(style), objectFit: 'cover' } }),
    useSafeAreaFrame: () => ({ width: '100%', height: 844 }), useSharedValue: reanimated.useSharedValue, useRef: React.useRef, useEffect: React.useEffect,
    useAnimatedStyle: reanimated.useAnimatedStyle, Animated: { View }, SPLASH_IMAGE: imageData, styles: styles(splash, splashConstants),
  });
  save('splash', 'פתיחת האפליקציה', React.createElement(SplashVisual, { expectedMs: 2600 }), true);
}
fs.writeFileSync(path.join(out, 'proof-scenes.json'), JSON.stringify(scenes, null, 2));
async function capture() {
  const { chromium } = require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const errors = [], results = [];
  try {
    const page = await browser.newPage(); page.on('pageerror', e => errors.push(e.message));
    for (const scene of scenes) for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 950 }); await page.goto(pathToFileURL(path.join(out, scene.filename)).href);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      if (overflow) throw Error('Horizontal overflow: ' + scene.filename + ' ' + width);
      if (width === 390) await page.screenshot({ path: path.join(out, `${scene.id}-${scene.phase}.png`), fullPage: true });
      results.push({ ...scene, width, horizontalOverflow: overflow });
    }
    if (errors.length) throw Error(errors.join('; '));
    fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify({ native: false, elapsedState: 'fixture; scheduling tested separately', errors, results }, null, 2));
    console.log(JSON.stringify({ regions: scenes.length, widthChecks: results.length, native: false }));
  } finally { await browser.close(); }
}
capture().catch(error => { console.error(error); process.exitCode = 1; });
