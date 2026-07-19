/* eslint-disable react-hooks/exhaustive-deps */
// DEV-ONLY animation lab — mounts the real product animations so they can be
// previewed and screen-recorded on the device without having to reach each
// live state. Guarded by __DEV__ at the call site; never shipped to production.
// One animation on screen at a time, with «הפעל שוב» + prev/next.
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { ANIM } from '@/components/anim/game/animConfig';

const NAVY = '#0B1B3B';
const CARD = '#0F2350';
const LIME = '#A3E635';
const BRAND = '#2563EB';
const INK = '#EAF0FB';
const E = ANIM.easing.out;

// ── 1. Registration success — ball rolls in an arc to the counter, +1 pop ──
function RegDemo({ token }: { token: number }) {
  const bx = useSharedValue(0);
  const by = useSharedValue(0);
  const bo = useSharedValue(0);
  const cs = useSharedValue(1);
  const [n, setN] = useState(7);
  useEffect(() => {
    setN(7);
    bx.value = 0; by.value = 0; bo.value = 0; cs.value = 1;
    bo.value = withSequence(withTiming(1, { duration: 120 }), withDelay(300, withTiming(0, { duration: 120 })));
    bx.value = withTiming(150, { duration: 520, easing: E });
    by.value = withSequence(
      withTiming(-70, { duration: 300, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 220, easing: Easing.in(Easing.quad) }),
    );
    const t = setTimeout(() => {
      setN(8);
      cs.value = withSequence(withTiming(1.18, { duration: 160, easing: E }), withTiming(1, { duration: 200, easing: E }));
    }, 560);
    return () => clearTimeout(t);
  }, [token]);
  const ball = useAnimatedStyle(() => ({ opacity: bo.value, transform: [{ translateX: bx.value }, { translateY: by.value }] }));
  const counter = useAnimatedStyle(() => ({ transform: [{ scale: cs.value }] }));
  return (
    <View style={s.scene}>
      <Animated.View style={[s.counter, counter]}><Text style={s.counterTxt}>{`${n}/14`}</Text></Animated.View>
      <View style={s.pillBtn}><Text style={s.pillTxt}>נרשמת ✓</Text></View>
      <Animated.View style={[s.ball, ball]} />
    </View>
  );
}

// ── 3. Last spot — goal posts close to center, net stretches, message ──
function LastSpotDemo({ token }: { token: number }) {
  const l = useSharedValue(-40);
  const r = useSharedValue(-40);
  const net = useSharedValue(0);
  const msg = useSharedValue(0);
  useEffect(() => {
    l.value = -40; r.value = -40; net.value = 0; msg.value = 0;
    l.value = withTiming(0, { duration: 500, easing: E });
    r.value = withTiming(0, { duration: 500, easing: E });
    net.value = withDelay(200, withSequence(withTiming(1.05, { duration: 320, easing: E }), withTiming(1, { duration: 160, easing: E })));
    msg.value = withDelay(480, withTiming(1, { duration: 320 }));
  }, [token]);
  const sl = useAnimatedStyle(() => ({ transform: [{ translateX: l.value }] }));
  const sr = useAnimatedStyle(() => ({ transform: [{ translateX: -r.value }] }));
  const sn = useAnimatedStyle(() => ({ transform: [{ scaleY: net.value }] }));
  const sm = useAnimatedStyle(() => ({ opacity: msg.value }));
  return (
    <View style={s.scene}>
      <Animated.View style={[s.postL, sl]} />
      <Animated.View style={[s.postR, sr]} />
      <Animated.View style={[s.net, sn]} />
      <Animated.Text style={[s.lastMsg, sm]}>תפסת את המקום האחרון</Animated.Text>
    </View>
  );
}

// ── 2. Waitlist → roster — avatar arcs up, ring appears ──
function PromotionDemo({ token }: { token: number }) {
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const ring = useSharedValue(0);
  useEffect(() => {
    x.value = 0; y.value = 0; ring.value = 0;
    x.value = withTiming(120, { duration: 500, easing: E });
    y.value = withSequence(withTiming(-110, { duration: 300, easing: Easing.out(Easing.quad) }), withTiming(-100, { duration: 200 }));
    ring.value = withDelay(520, withSequence(withTiming(1, { duration: 220, easing: E }), withTiming(0, { duration: 260 })));
  }, [token]);
  const av = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }] }));
  const rg = useAnimatedStyle(() => ({ opacity: ring.value, transform: [{ scale: 0.7 + ring.value * 0.5 }] }));
  return (
    <View style={s.scene}>
      <View style={[s.zone, { top: 20, right: 20 }]}><Text style={s.zoneT}>הרכב</Text></View>
      <View style={[s.zone, { bottom: 20, left: 20 }]}><Text style={s.zoneT}>המתנה</Text></View>
      <Animated.View style={[s.avatar, { bottom: 46, left: 60 }, av]} />
      <Animated.View style={[s.ring, { top: 46, right: 90 }, rg]} />
    </View>
  );
}

// ── 5. Next game card entrance — card fades+rises, rows stagger ──
function NextCardDemo({ token }: { token: number }) {
  const card = useSharedValue(0);
  const r0 = useSharedValue(0);
  const r1 = useSharedValue(0);
  const r2 = useSharedValue(0);
  const r3 = useSharedValue(0);
  const cta = useSharedValue(0);
  useEffect(() => {
    [card, r0, r1, r2, r3, cta].forEach((v) => (v.value = 0));
    card.value = withTiming(1, { duration: 320, easing: E });
    [r0, r1, r2, r3].forEach((r, i) => (r.value = withDelay(60 + i * 80, withTiming(1, { duration: 300, easing: E }))));
    cta.value = withDelay(60 + 4 * 80, withTiming(1, { duration: 300, easing: E }));
  }, [token]);
  const cardS = useAnimatedStyle(() => ({ opacity: card.value, transform: [{ translateY: 14 * (1 - card.value) }] }));
  const s0 = useAnimatedStyle(() => ({ opacity: r0.value, transform: [{ translateY: 8 * (1 - r0.value) }] }));
  const s1 = useAnimatedStyle(() => ({ opacity: r1.value, transform: [{ translateY: 8 * (1 - r1.value) }] }));
  const s2 = useAnimatedStyle(() => ({ opacity: r2.value, transform: [{ translateY: 8 * (1 - r2.value) }] }));
  const s3 = useAnimatedStyle(() => ({ opacity: r3.value, transform: [{ translateY: 8 * (1 - r3.value) }] }));
  const ctaS = useAnimatedStyle(() => ({ opacity: cta.value, transform: [{ translateY: 8 * (1 - cta.value) }] }));
  return (
    <View style={s.scene}>
      <Animated.View style={[s.demoCard, cardS]}>
        <Animated.View style={[s.rTitle, s0]} />
        <Animated.View style={[s.rLine, { width: '80%' }, s1]} />
        <Animated.View style={[s.rLine, { width: '55%' }, s2]} />
        <Animated.View style={[s.rLine, { width: '70%' }, s3]} />
        <Animated.View style={[s.rCta, ctaS]} />
      </Animated.View>
    </View>
  );
}

// ── 7. Live entrance — field lines meet center, clock scales in, controls up ──
function LiveDemo({ token }: { token: number }) {
  const fl = useSharedValue(0);
  const clock = useSharedValue(0);
  const cs = useSharedValue(0.96);
  const ctrl = useSharedValue(0);
  useEffect(() => {
    fl.value = 0; clock.value = 0; cs.value = 0.96; ctrl.value = 0;
    fl.value = withTiming(1, { duration: 450, easing: E });
    clock.value = withDelay(350, withTiming(1, { duration: 320 }));
    cs.value = withDelay(350, withTiming(1, { duration: 420, easing: E }));
    ctrl.value = withDelay(500, withTiming(1, { duration: 380, easing: E }));
  }, [token]);
  // Field line "draws" across the centre (scaleX from the middle out).
  const ln = useAnimatedStyle(() => ({ transform: [{ scaleX: fl.value }] }));
  const cl = useAnimatedStyle(() => ({ opacity: clock.value, transform: [{ scale: cs.value }] }));
  const ct = useAnimatedStyle(() => ({ opacity: ctrl.value, transform: [{ translateY: 14 * (1 - ctrl.value) }] }));
  return (
    <View style={[s.scene, { backgroundColor: '#06122B' }]}>
      <Animated.View style={[s.halfLine, ln]} />
      <Animated.View style={[s.clock, cl]}><Text style={s.clockTxt}>12:00</Text></Animated.View>
      <Animated.View style={[s.ctrlBar, ct]} />
    </View>
  );
}

// ── 12. Draft pick — player card arcs to team, shadow left, ring ──
function DraftDemo({ token }: { token: number }) {
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const sc = useSharedValue(1);
  const shadow = useSharedValue(0.5);
  const ring = useSharedValue(0);
  useEffect(() => {
    x.value = 0; y.value = 0; sc.value = 1; shadow.value = 0.5; ring.value = 0;
    x.value = withTiming(-150, { duration: 500, easing: E });
    y.value = withSequence(withTiming(-40, { duration: 300, easing: Easing.out(Easing.quad) }), withTiming(20, { duration: 200 }));
    sc.value = withTiming(0.85, { duration: 500 });
    shadow.value = withTiming(0, { duration: 500 });
    ring.value = withDelay(540, withSequence(withTiming(1, { duration: 240, easing: E }), withTiming(0, { duration: 260 })));
  }, [token]);
  const pl = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }, { scale: sc.value }] }));
  const sh = useAnimatedStyle(() => ({ opacity: shadow.value }));
  const rg = useAnimatedStyle(() => ({ opacity: ring.value }));
  return (
    <View style={s.scene}>
      <View style={[s.zone, { top: 24, right: 24, height: 150 }]}><Text style={s.zoneT}>זמינים</Text></View>
      <View style={[s.teamCol, { top: 24, left: 24 }]} />
      <Animated.View style={[s.ring, { top: 30, left: 30, width: 84, height: 140, borderRadius: 12 }, rg]} />
      <Animated.View style={[s.avatar, { top: 44, right: 60, backgroundColor: '#334155' }, sh]} />
      <Animated.View style={[s.avatar, { top: 44, right: 60 }, pl]} />
    </View>
  );
}

// ── 13. Auto balance — avatars bob (compute) then settle into 2 columns ──
function BalanceDemo({ token }: { token: number }) {
  // `bob` drives the short compute phase (two gentle lifts — "computing", not
  // a random spin); p0..p3 (0→1) drive each avatar's travel to its column.
  const bob = useSharedValue(0);
  const p0 = useSharedValue(0);
  const p1 = useSharedValue(0);
  const p2 = useSharedValue(0);
  const p3 = useSharedValue(0);
  const cols = useSharedValue(0);
  useEffect(() => {
    [bob, p0, p1, p2, p3, cols].forEach((v) => (v.value = 0));
    bob.value = withSequence(
      withTiming(1, { duration: 220, easing: E }),
      withTiming(0, { duration: 220, easing: E }),
      withTiming(1, { duration: 180, easing: E }),
      withTiming(0, { duration: 180, easing: E }),
    );
    [p0, p1, p2, p3].forEach((v, i) => (v.value = withDelay(560 + i * 45, withTiming(1, { duration: 340, easing: E }))));
    cols.value = withDelay(560, withTiming(1, { duration: 360 }));
  }, [token]);
  // Avatars start clustered centre; two travel right, two left, into columns.
  const st0 = useAnimatedStyle(() => ({ transform: [{ translateX: 96 * p0.value }, { translateY: -44 * p0.value - 10 * bob.value }] }));
  const st1 = useAnimatedStyle(() => ({ transform: [{ translateX: -96 * p1.value }, { translateY: -44 * p1.value - 10 * bob.value }] }));
  const st2 = useAnimatedStyle(() => ({ transform: [{ translateX: 96 * p2.value }, { translateY: 16 * p2.value - 10 * bob.value }] }));
  const st3 = useAnimatedStyle(() => ({ transform: [{ translateX: -96 * p3.value }, { translateY: 16 * p3.value - 10 * bob.value }] }));
  const colS = useAnimatedStyle(() => ({ opacity: cols.value }));
  return (
    <View style={s.scene}>
      <Animated.View style={[s.teamCol, { top: 20, right: 34 }, colS]} />
      <Animated.View style={[s.teamCol, { top: 20, left: 34 }, colS]} />
      <Animated.View style={[s.avatar, { top: 96, left: 116 }, st0]} />
      <Animated.View style={[s.avatar, { top: 96, left: 152 }, st1]} />
      <Animated.View style={[s.avatar, { top: 96, left: 188 }, st2]} />
      <Animated.View style={[s.avatar, { top: 96, left: 224 }, st3]} />
    </View>
  );
}

const SCENES: { key: string; title: string; desc: string; Comp: React.FC<{ token: number }> }[] = [
  { key: 'reg', title: '1 · הרשמה למשחק', desc: 'כדור בקשת אל המונה → +1 עם pop', Comp: RegDemo },
  { key: 'promo', title: '2 · קידום מהמתנה', desc: 'אווטאר עולה בקשת להרכב → טבעת', Comp: PromotionDemo },
  { key: 'last', title: '3 · תפיסת המקום האחרון', desc: 'קווי-שער נסגרים + רשת נמתחת', Comp: LastSpotDemo },
  { key: 'card', title: '5 · כרטיס המשחק הבא', desc: 'fade+עלייה + stagger שורות', Comp: NextCardDemo },
  { key: 'live', title: '7 · מעבר ללייב', desc: 'קווי-מגרש → שעון scale → פקדים', Comp: LiveDemo },
  { key: 'draft', title: '12 · בחירת שחקן בדראפט', desc: 'כרטיס טס לקבוצה + צללית + טבעת', Comp: DraftDemo },
  { key: 'bal', title: '13 · איזון כוחות', desc: 'שלב-חישוב → התמקמות בקבוצות', Comp: BalanceDemo },
];

export function AnimationLab({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [token, setToken] = useState(0);
  useEffect(() => {
    if (visible) setToken((t) => t + 1);
  }, [visible, i]);
  const scene = SCENES[i];
  const Comp = scene.Comp;
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        <View style={s.header}>
          <Text style={s.title}>{scene.title}</Text>
          <Text style={s.desc}>{scene.desc}</Text>
        </View>
        <View style={s.stageWrap}>
          <Comp token={token} />
        </View>
        <View style={s.controls}>
          <Pressable style={s.navBtn} onPress={() => setI((v) => (v - 1 + SCENES.length) % SCENES.length)}>
            <Text style={s.navTxt}>‹ הקודם</Text>
          </Pressable>
          <Pressable style={s.replay} onPress={() => setToken((t) => t + 1)}>
            <Text style={s.replayTxt}>הפעל שוב ↻</Text>
          </Pressable>
          <Pressable style={s.navBtn} onPress={() => setI((v) => (v + 1) % SCENES.length)}>
            <Text style={s.navTxt}>הבא ›</Text>
          </Pressable>
        </View>
        <Pressable style={s.close} onPress={onClose}>
          <Text style={s.closeTxt}>סגור מעבדה</Text>
        </Pressable>
        <Text style={s.counterLbl}>{`${i + 1} / ${SCENES.length}`}</Text>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: NAVY },
  header: { paddingHorizontal: 20, paddingTop: 12, alignItems: 'flex-end' },
  title: { color: INK, fontSize: 20, fontWeight: '900', textAlign: 'right' },
  desc: { color: '#93A3BF', fontSize: 12, marginTop: 2, textAlign: 'right' },
  stageWrap: { flex: 1, margin: 20, borderRadius: 20, overflow: 'hidden', backgroundColor: CARD },
  scene: { flex: 1, backgroundColor: CARD, position: 'relative' },
  controls: { flexDirection: 'row-reverse', justifyContent: 'center', alignItems: 'center', gap: 12, paddingHorizontal: 20 },
  navBtn: { paddingVertical: 10, paddingHorizontal: 14 },
  navTxt: { color: '#93A3BF', fontSize: 14, fontWeight: '700' },
  replay: { backgroundColor: BRAND, borderRadius: 999, paddingVertical: 11, paddingHorizontal: 22 },
  replayTxt: { color: '#fff', fontSize: 15, fontWeight: '900' },
  close: { alignSelf: 'center', marginTop: 14 },
  closeTxt: { color: '#93A3BF', fontSize: 13 },
  counterLbl: { color: '#5B6B88', fontSize: 12, textAlign: 'center', marginTop: 6, marginBottom: 8 },
  // shared scene pieces
  counter: { position: 'absolute', top: 30, left: 30, minWidth: 66, height: 42, borderRadius: 10, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  counterTxt: { fontSize: 15, fontWeight: '900', color: INK },
  pillBtn: { position: 'absolute', bottom: 34, right: 30, width: 130, height: 42, borderRadius: 999, backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center' },
  pillTxt: { color: '#fff', fontWeight: '800', fontSize: 13 },
  ball: { position: 'absolute', bottom: 40, right: 160, width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' },
  postL: { position: 'absolute', top: 40, height: 150, width: 4, right: '50%', backgroundColor: '#fff' },
  postR: { position: 'absolute', top: 40, height: 150, width: 4, left: '50%', backgroundColor: '#fff' },
  net: { position: 'absolute', top: 70, alignSelf: 'center', width: 130, height: 70, backgroundColor: 'rgba(163,230,53,0.18)', borderColor: LIME, borderWidth: 1, borderRadius: 8 },
  lastMsg: { position: 'absolute', bottom: 30, alignSelf: 'center', color: LIME, fontSize: 16, fontWeight: '900' },
  zone: { position: 'absolute', width: 120, height: 76, borderWidth: 1, borderColor: '#31456B', borderStyle: 'dashed', borderRadius: 12, padding: 6, alignItems: 'flex-end' },
  zoneT: { color: '#7C8DB0', fontSize: 11, fontWeight: '700' },
  avatar: { position: 'absolute', width: 34, height: 34, borderRadius: 17, backgroundColor: BRAND, borderWidth: 2, borderColor: '#fff' },
  ring: { position: 'absolute', width: 46, height: 46, borderRadius: 23, borderWidth: 3, borderColor: LIME },
  demoCard: { position: 'absolute', top: 30, left: 30, right: 30, backgroundColor: '#fff', borderRadius: 14, padding: 16 },
  rTitle: { height: 16, width: '60%', borderRadius: 6, backgroundColor: BRAND, marginBottom: 12 },
  rLine: { height: 12, borderRadius: 6, backgroundColor: '#E2E8F0', marginBottom: 10 },
  rCta: { height: 30, width: 120, borderRadius: 999, backgroundColor: BRAND, marginTop: 4 },
  halfLine: { position: 'absolute', top: 165, left: 24, right: 24, height: 2, backgroundColor: 'rgba(255,255,255,0.4)' },
  clock: { position: 'absolute', top: 46, alignSelf: 'center', width: 100, height: 100, borderRadius: 50, borderWidth: 4, borderColor: LIME, alignItems: 'center', justifyContent: 'center' },
  clockTxt: { color: '#fff', fontSize: 22, fontWeight: '900' },
  ctrlBar: { position: 'absolute', bottom: 24, left: 24, right: 24, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.14)' },
  teamCol: { position: 'absolute', width: 74, height: 150, borderWidth: 1, borderColor: '#31456B', borderRadius: 12 },
});
