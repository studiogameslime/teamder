import React from 'react';
let mockReduced = false;
let mockHoldAnimation = false;
jest.mock('react', () => {
 let slots: any[] = [], cursor = 0, pending: Array<() => void> = [];
 const same = (a: any[], b: any[]) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
 return { ...jest.requireActual('react'),
  __runtime: { begin: () => { cursor = 0; }, finish: () => { const work = pending; pending = []; work.forEach(f => f()); }, reset: () => { slots.forEach(s => s?.cleanup?.()); slots = []; cursor = 0; pending = []; }, unmount: () => slots.forEach(s => s?.cleanup?.()) },
  useRef: (initial: any) => { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }); },
  useState: (initial: any) => { const i = cursor++; return [slots[i] ?? (slots[i] = initial), (v: any) => { slots[i] = v; }]; },
  useEffect: (effect: () => void, deps: any[]) => { const i = cursor++, previous = slots[i]; if (!same(previous?.deps, deps)) { slots[i] = { deps }; pending.push(() => { previous?.cleanup?.(); slots[i].cleanup = effect(); }); } },
 };
});
jest.mock('react-native', () => ({ Image: 'Image', Pressable: 'Pressable', Text: 'Text', View: 'View', I18nManager: { isRTL: true }, StyleSheet: { create: (v: unknown) => v, absoluteFillObject: {} } }));
jest.mock('react-native-svg', () => ({ __esModule: true, default: 'Svg', Circle: 'Circle', Path: 'Path' }));
jest.mock('react-native-reanimated', () => ({ __esModule: true, default: { View: 'AnimatedView' },
 useSharedValue: (initial: unknown) => require('react').useRef({ value: initial }).current,
 useAnimatedStyle: (make: () => unknown) => ({ get current() { return make(); } }),
 cancelAnimation: jest.fn(), withTiming: (v: unknown) => mockHoldAnimation ? 0 : v, withSpring: (v: unknown) => v, withDelay: (_: number, v: unknown) => v,
 withSequence: (...values: unknown[]) => values.at(-1), withRepeat: (v: unknown) => v,
}));
jest.mock('@/components/UserAvatar', () => ({ UserAvatar: 'Avatar' }));
jest.mock('@/hooks/animations/useReducedMotion', () => ({ useReducedMotion: () => mockReduced }));
jest.mock('@/assets/images/match-action-grass.png', () => 'local-grass');
jest.mock('@/assets/images/match-football.png', () => 'local-football');
import { MatchActionPitch } from '@/components/match/MatchActionPitch';
const runtime = (require('react') as any).__runtime;
const person = { player: { id: 'p1', name: 'גל', isFiller: false }, label: 'כובש', color: '#22C55E' };
const props = () => ({ mode: 'goal' as const, primary: person, secondary: { ...person, player: { ...person.player, id: 'p2' }, label: 'מבשל' }, activeRole: null, status: 'idle' as any, onAnimationComplete: jest.fn() });
function nodes(n: any): any[] { if (!n || typeof n !== 'object') return []; if (Array.isArray(n)) return n.flatMap(nodes); return [n, ...nodes(n.props?.children)]; }
function render(input: any) { runtime.begin(); const tree = MatchActionPitch(input); runtime.finish(); return tree; }
beforeEach(() => { jest.useFakeTimers(); runtime.reset(); mockReduced = false; mockHoldAnimation = false; });
afterEach(() => { runtime.reset(); jest.useRealTimers(); });

test.each(['idle', 'saving', 'error'])('status %s cannot announce success or finish an animation', status => {
 const input = { ...props(), status }, tree = render(input);
 jest.runAllTimers(); expect(input.onAnimationComplete).not.toHaveBeenCalled();
 expect(nodes(tree).some(n => n.type === 'Text' && n.props.children === 'גול!')).toBe(false);
});
test.each(['idle', 'saving', 'error'])('goal %s hides the ball before acknowledgement, including after selecting a scorer', status => {
 const input = { ...props(), status, primary: { ...person, player: null }, secondary: { ...person, player: null, label: 'מבשל' } };
 const ball = nodes(render(input)).find(n => n.props?.testID === 'match-action-ball');
 expect(ball).toBeUndefined();
 const selected = nodes(render({ ...input, primary: person })).find(n => n.props?.testID === 'match-action-ball');
 expect(selected).toBeUndefined();
});
test.each([true, false])('an acknowledged goal starts at the assister only when one was selected: %s', assisted => {
 mockHoldAnimation = true;
 const input = { ...props(), status: 'saved', secondary: { ...props().secondary, player: assisted ? props().secondary.player : null } };
 const ball = nodes(render(input)).find(n => n.props?.testID === 'match-action-ball');
 expect(ball.props.style[1].current.transform[0].translateX).toBeCloseTo(340 * ((assisted ? 0.25 : 0.75) - 1) + 12);
 expect(ball.props.style[1].current.transform[1].translateY).toBeCloseTo(248 * (assisted ? 0.59 : 0.34) - 12);
});
test('the first-team preview reuses the pitch without participant controls or a stationary ball', () => {
 const tree=render({...props(),mode:'penalty',teamPreview:true,activeRole:null});
 expect(nodes(tree).find(n=>n.props?.testID==='match-action-ball')).toBeUndefined();
 expect(nodes(tree).filter(n=>typeof n.type==='function'&&n.type.name==='Participant')).toHaveLength(0);
});
test.each([{height:140,width:250},{height:180,width:300},{height:248,width:340}])('the waiting penalty ball stays beside the kicker disc, away from keeper metadata at %j', ({height,width}) => {
 const input = {...props(), mode:'penalty',height,primary:{...person,label:'בועט'},secondary:{...person,label:'שוער'}};
 let tree=render(input);tree.props.onLayout({nativeEvent:{layout:{width}}});tree=render(input);
 const ball=nodes(tree).find(n=>n.props?.testID==='match-action-ball');
 const transform=ball.props.style[1].current.transform;
 const centerX=width-12+transform[0].translateX,centerY=12+transform[1].translateY;
 const slot=nodes(tree).find(n=>typeof n.type==='function' && n.type.name==='Participant' && n.props.person.label==='בועט');
 // Read the real disc's size rather than copying the component's breakpoints.
 runtime.reset();runtime.begin();const participant=slot.type(slot.props);runtime.finish();
 const disc=nodes(participant).find(n=>n.type==='AnimatedView' && n.props.style?.[0]?.borderWidth===2);
 const radius=disc.props.style.at(-1).width/2;
 expect(Math.abs(centerX-width*slot.props.x)).toBeGreaterThanOrEqual(radius+12+6);
 expect(centerY-12).toBeGreaterThanOrEqual(height*slot.props.y-radius);
 expect(centerY+12).toBeLessThanOrEqual(height*slot.props.y+radius);
});

test.each([140,180,248])('a penalty starts its acknowledged movement at the waiting ball without jumping at height %s',height=>{
 const input={...props(),mode:'penalty',height};
 const before=nodes(render(input)).find(n=>n.props?.testID==='match-action-ball').props.style[1].current.transform;
 mockHoldAnimation=true;
 const after=nodes(render({...input,status:'saved'})).find(n=>n.props?.testID==='match-action-ball').props.style[1].current.transform;
 expect(after).toEqual(before);
});
test('only an acknowledged event celebrates and finishes once', () => {
 const input = { ...props(), status: 'saved', animationKey: 'saved-id' };
 const tree = render(input);
 expect(nodes(tree).some(n => n.type === 'Text' && n.props.children === 'גול!')).toBe(true);
 jest.advanceTimersByTime(1179); expect(input.onAnimationComplete).not.toHaveBeenCalled();
 jest.advanceTimersByTime(1); expect(input.onAnimationComplete).toHaveBeenCalledTimes(1);
 render(input); jest.runAllTimers(); expect(input.onAnimationComplete).toHaveBeenCalledTimes(1);
});
test.each(['goal', 'save', 'miss'])('penalty %s reaches a distinct physical endpoint in RTL', outcome => {
 const input = { ...props(), mode: 'penalty', status: 'saved', outcome };
 const tree = render(input);
 const ball = nodes(tree).find(n => n.type === 'AnimatedView' && n.props.style?.[0]?.width === 24);
 const x = ball.props.style[1].current.transform[0].translateX;
 expect(x).toBeCloseTo(outcome === 'goal' ? -158 : outcome === 'save' ? -178.4 : -1.6);
 expect(nodes(tree).some(n => n.type === 'Text' && n.props.children === (outcome === 'goal' ? 'גול!' : outcome === 'save' ? 'עצירה!' : 'מחוץ למסגרת'))).toBe(true);
});
test.each(['hide', 'unmount', 'new-event'])('%s cancels a stale completion callback', action => {
 const old = { ...props(), status: 'saved', animationKey: 'old' }; render(old);
 if (action === 'unmount') runtime.unmount();
 else render({ ...old, visible: action === 'hide' ? false : true, status: 'idle', animationKey: 'new' });
 jest.runAllTimers(); expect(old.onAnimationComplete).not.toHaveBeenCalled();
});
test('reduced motion completes as a short acknowledgement without waiting for a moving pass', () => {
 mockReduced = true; const input = { ...props(), status: 'saved' }; render(input);
 jest.advanceTimersByTime(169); expect(input.onAnimationComplete).not.toHaveBeenCalled();
 jest.advanceTimersByTime(1); expect(input.onAnimationComplete).toHaveBeenCalledTimes(1);
});
