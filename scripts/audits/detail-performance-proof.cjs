// Static source previews. Hook/network states are fixtures backed by separate
// scheduling tests. This is browser QA, not an Android/iOS render measurement.
const fs = require('fs');
const sharedFile = fs.readFileSync('scripts/audits/screen-performance-proof.cjs', 'utf8');
let prelude = sharedFile.slice(0, sharedFile.indexOf('const scenes = []'));
prelude = prelude.replace("path.resolve('artifacts/performance-2026-11-04')", "path.resolve('artifacts/detail-performance-2026-11-04')");
prelude = prelude.replace("new Function('require', 'module', 'exports', code)(name => {", "new Function('require', 'module', 'exports', code)(name => { const custom = specialDependency(name, file); if (custom !== null) return custom;");
prelude = prelude.replace("new Function('require', 'module', 'exports', code)", "new Function('require', 'module', 'exports', '__DEV__', code)").replace('}, module, module.exports);', '}, module, module.exports, false);');
const extension = String.raw`
let simulation = {}, stateOrder = {};
const jsx = React.createElement;
const generic = new Proxy({}, { get: (_target, key) => key === '__esModule' ? false : noop });
function reactFor(file) {
  const tree = source(file), setters = [];
  const componentNames = { 'OwnPlayerCard.tsx': 'OwnPlayerCard', 'ManagerDashboardScreen.tsx': 'ManagerDashboardScreen', 'SeasonSummaryScreen.tsx': 'SeasonSummaryScreen' };
  const component = componentNames[path.basename(file)] ? find(tree, node => ts.isFunctionDeclaration(node) && node.name?.text === componentNames[path.basename(file)]) : tree;
  const walk = node => {
    if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.initializer &&
      ts.isCallExpression(node.initializer) && /(?:^|\.)useState$/.test(node.initializer.expression.getText(tree))) setters.push(node.name.elements[1].getText(tree));
    ts.forEachChild(node, walk);
  }; walk(component);
  let index = 0;
  return { ...React, useEffect: noop, useLayoutEffect: noop,
    useState(initial) {
      const setter = setters[index++], values = simulation.states?.[path.relative(process.cwd(), file).replace(/\\/g, '/')] ?? {};
      return React.useState(Object.prototype.hasOwnProperty.call(values, setter) ? values[setter] : initial);
    },
  };
}
function specialDependency(name, file) {
  if (name === 'react') return reactFor(file);
  if (/\.(png|jpg|jpeg)$/.test(name)) {
    const imagePath = name.startsWith('@/') ? path.resolve('src', name.slice(2)) : path.resolve(path.dirname(file), name);
    return { uri: 'data:image/png;base64,' + fs.readFileSync(imagePath).toString('base64') };
  }
  if (name === 'react-native-safe-area-context') return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }), useSafeAreaFrame: () => ({ width: 390, height: 844 }) };
  if (name === '@react-navigation/native') return { useFocusEffect: noop, useIsFocused: () => true, useNavigation: () => ({ navigate: noop, goBack: noop, setParams: noop, canGoBack: () => true }), useRoute: () => ({ key: 'fixture', params: simulation.params ?? {} }) };
  if (name === 'react-native-svg') return { __esModule: true, default: 'svg', Svg: 'svg', Path: 'path', Circle: 'circle', Rect: 'rect', Line: 'line', Text: 'text', Defs: 'defs', Stop: 'stop', LinearGradient: 'linearGradient', RadialGradient: 'radialGradient', Ellipse: 'ellipse', G: 'g' };
  if (name.endsWith('/useManagerDashboardScores')) return { useManagerDashboardScores: () => ({ data: simulation.managerData, loading: !!simulation.scoresLoading, failed: !!simulation.scoresFailed, needsBaseRefresh: !!simulation.needsBaseRefresh, retry: noop }) };
  if (name.endsWith('/store/userStore')) {
    const currentUser = simulation.currentUser;
    return { useUserStore: Object.assign(select => select({ currentUser }), { getState: () => ({ currentUser }) }) };
  }
  if (name.endsWith('/store/groupStore')) return { useGroupStore: Object.assign(select => select({ groups: simulation.groups ?? [] }), { getState: () => ({ groups: simulation.groups ?? [] }) }), useIsAdmin: () => true };
  if (name.endsWith('/store/gameStore')) return { useGameStore: Object.assign(select => select({ players: {} }), { getState: () => ({ players: {} }) }) };
  if (name.endsWith('/UserAvatar')) return { UserAvatar: ({ user, size = 42 }) => jsx(View, { style: { width: size, height: size, borderRadius: size / 2, backgroundColor: '#DDE9FB', alignItems: 'center', justifyContent: 'center' } }, jsx(Text, null, user?.name?.[0] ?? '')) };
  if (name.endsWith('/ScreenHeader')) return { ScreenHeader: ({ title }) => jsx(Text, { style: { padding: 16, fontSize: 21, fontWeight: '700', color: '#15244F', backgroundColor: 'white' } }, title) };
  if (name.endsWith('/Toast')) return { toast: { success: noop, error: noop, info: noop } };
  if (name.endsWith('/AppDialog')) return { appAlert: noop };
  if (name.endsWith('/AdminRatingSheet')) return { AdminRatingSheet: () => null };
  if (name.endsWith('/InfoTip')) return { InfoTip: () => jsx(Icon, { size: 14 }) };
  if (name.endsWith('/ComparisonActivitySection')) return { ComparisonActivitySection: () => null };
  if (name.endsWith('/Button')) return { Button: ({ title, disabled }) => jsx(View, { style: { padding: 12, backgroundColor: disabled ? '#E3EBF7' : '#2467F4', borderRadius: 12, opacity: disabled ? 0.6 : 1 } }, jsx(Text, { style: { color: 'white', textAlign: 'center' } }, title)) };
  if (name.endsWith('/ScrollSurface')) return { ScrollSurface: Scroll };
  if (name.endsWith('/SafeModal')) return { SafeModal: ({ visible, children }) => visible ? jsx(View, null, children) : null };
  if (/\/(?:ContentReveal|HeightReveal|ScreenEntrance|ChangeMotion)$/.test(name)) return new Proxy({}, { get: () => View });
  if (name.endsWith('/PressableScale')) return { PressableScale: View };
  if (name === 'expo-linear-gradient') return { LinearGradient: View };
  if (name === 'expo-constants') return { __esModule: true, default: { expoConfig: {} } };
  if (name === 'react-native-view-shot') return { captureRef: noop };
  if (name === '@/firebase/config') return { USE_MOCK_DATA: false, getFirebase: () => ({ auth: { currentUser: { uid: simulation.currentUser?.id, isAnonymous: false } } }) };
  if (name !== '@/services/gameLifecycle' && /^(?:@\/services(?:\/|$)|\.\.\/.*services\/|\.\/.*Service$)/.test(name)) return generic;
  if (/errorObservation$/.test(name)) return { observeCaughtError: noop };
  if (name.startsWith('expo-') || name.startsWith('@react-native-') || name === 'react-native-gesture-handler') return generic;
  return null;
}
function Scroll({ style, contentContainerStyle, children }) { return jsx(View, { style }, jsx(View, { style: contentContainerStyle }, children)); }
Object.assign(RN, { ScrollView: Scroll, ImageBackground: ({ source: image, style, children }) => jsx(View, { style: { ...flat(style), backgroundImage: image?.uri ? 'url(' + image.uri + ')' : undefined, backgroundSize: 'cover', backgroundPosition: 'center' } }, children),
  Image: ({ source: image, style }) => jsx('img', { src: image?.uri, style: { ...css(style), objectFit: 'cover' } }), RefreshControl: () => null,
  TextInput: ({ placeholder, style }) => jsx(View, { style }, jsx(Text, null, placeholder)), ActivityIndicator: () => jsx(View, { style: { width: 18, height: 18, borderWidth: 3, borderColor: '#CADAF4', borderTopColor: '#2467F4', borderRadius: 15 } }),
  useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1, scale: 1 }), BackHandler: { addEventListener: () => ({ remove: noop }) }, Platform: { OS: 'android', select: values => values.android ?? values.default }, I18nManager: { isRTL: true },
  AccessibilityInfo: { isReduceMotionEnabled: async () => true, addEventListener: () => ({ remove: noop }) }, useColorScheme: () => 'light', Share: {}, Linking: {}, Keyboard: { dismiss: noop } });
Object.assign(reanimated.Easing, { bezier: noop, in: noop, cubic: noop, linear: noop });
Object.assign(reanimated.default, { createAnimatedComponent: component => component });
// Native off-screen capture surfaces are not part of the visible viewport.
// CSS includes their fixed width in document.scrollWidth unless omitted here.
RN.View = props => flat(props.style).position === 'absolute' && flat(props.style).top < -1000 ? null : jsx(View, props);
const card = JSON.parse(fs.readFileSync(path.join(out, 'card-preview-data.json')));
const manager = JSON.parse(fs.readFileSync(path.join(out, 'manager-preview-data.json')));
const season = JSON.parse(fs.readFileSync(path.join(out, 'season-preview-data.json')));
const scenes = [];
function render(id, phaseValue, sim, file, name, props = {}) {
  phase = phaseValue; simulation = sim; cache = {};
  theme = { RTL_LABEL_ALIGN: 'left', ...load('src/theme/colors.ts'), ...load('src/theme/spacing.ts'), ...load('src/theme/typography.ts'), ...load('src/theme/clubAccents.ts') };
  const body = jsx(load(file)[name], props);
  let html;
  try { html = renderToStaticMarkup(body); } catch (error) { throw new Error(id + '-' + phase + ': ' + error.message, { cause: error }); }
  const filename = id + '-' + phase + '.html';
  fs.writeFileSync(path.join(out, filename), '<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><style>body{margin:0;background:#F3F7FC;font-family:Arial;color:#15244F}.fixture{font:11px Arial;color:#64748B;padding:8px 16px}main{display:flex;flex-direction:column;position:relative;min-height:844px}*{box-sizing:border-box}svg{max-width:100%}</style><div class="fixture">רכיבי מקור, נתוני הדגמה ומתאמי דפדפן</div><main>'+html+'</main></html>');
  scenes.push({ id, phase, filename, source: file });
}
for (const state of ['before', 'after']) {
  const ownState = { ...card.stateBySetter };
  if (state === 'before') for (const key of ['setData', 'setLastStats']) ownState[key] = { loading: true };
  render('card-early', state, { currentUser: card.currentUser, groups: card.props?.preview?.clubs ?? [], states: { 'src/components/profile/OwnPlayerCard.tsx': ownState } }, 'src/components/profile/OwnPlayerCard.tsx', 'OwnPlayerCard', card.props);
  const summaryScope = JSON.stringify([season.groupId, 'owner', false, season.seasonId]);
  render('season-early', state, { currentUser: { id: 'owner', name: 'שחקן הדגמה', createdAt: 0 }, params: { groupId: season.groupId, seasonId: season.seasonId }, states: { 'src/screens/profile/SeasonSummaryScreen.tsx': { setModel: state === 'before' ? null : season, setLoadedScope: summaryScope, setLoading: state === 'before', setTab: 'personal' } } }, 'src/screens/profile/SeasonSummaryScreen.tsx', 'SeasonSummaryScreen');
  const currentUser = { id: manager.viewerId, name: 'מנהל המועדון', createdAt: 0 };
  for (const tab of ['club', 'ratings']) render('manager-' + tab, state, { currentUser, params: { groupId: manager.data.group.id, initialTab: tab }, managerData: state === 'before' ? null : manager.loadingData, scoresLoading: tab === 'ratings', states: { 'src/screens/communities/ManagerDashboardScreen.tsx': { setSnapshot: state === 'before' ? null : { owner: JSON.stringify([manager.data.group.id, manager.viewerId, false]), data: manager.loadingData }, setLoading: state === 'before', setNow: manager.now, setTab: tab } } }, 'src/screens/communities/ManagerDashboardScreen.tsx', 'ManagerDashboardScreen');
  render('manager-player', state, { currentUser }, 'src/components/manager/ManagerWorkspace.tsx', 'ManagerWorkspace', {
    data: state === 'before' ? manager.data : manager.loadingData, now: manager.now, viewerId: manager.viewerId, initialPlayer: manager.initialPlayer,
    onRound: noop, onPlayer: noop, onHistory: noop, onRatings: noop, onEquipment: noop, onRate: noop, onPageChange: noop, onBackChange: noop,
    renderTrend: () => jsx(View, { style: { height: 75, backgroundColor: '#EFF5FC' } }), onScoresNeeded: state === 'after' ? noop : undefined, scoresLoading: state === 'after', onRetryScores: noop,
  });
}
fs.writeFileSync(path.join(out, 'proof-scenes.json'), JSON.stringify(scenes, null, 2));
async function capture() {
  const { chromium } = require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  const browser = await chromium.launchPersistentContext(path.join(out, 'browser-profile'), { executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await browser.newPage(), errors = [], results = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    for (const scene of scenes) for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 950 }); await page.goto(pathToFileURL(path.join(out, scene.filename)).href);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      if (overflow) throw Error('Horizontal overflow: ' + scene.filename + ' ' + width);
      if (width === 390) await page.screenshot({ path: path.join(out, scene.id + '-' + scene.phase + '.png'), fullPage: true });
      results.push({ ...scene, width, horizontalOverflow: false });
    }
    if (errors.length) throw Error(errors.join('; '));
    fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify({ native: false, elapsedState: 'fixture; source scheduling measured separately', errors, results }, null, 2));
    console.log(JSON.stringify({ regions: scenes.length, widthChecks: results.length, native: false }));
  } finally { await browser.close(); }
}
capture().catch(error => { console.error(error); process.exitCode = 1; });
`;
new Function('require', 'process', '__dirname', prelude + extension)(require, process, __dirname);
