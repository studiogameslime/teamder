import React, { useEffect, useRef, useState } from 'react';
import { Image, I18nManager, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { UserAvatar } from '@/components/UserAvatar';
import { useReducedMotion } from '@/hooks/animations/useReducedMotion';
import type { PenaltyOutcome } from '@/types';
import type { RosterMember } from './rotationView';
import { TeamShirtIllustration } from './TeamShirt';

export interface PitchParticipant {
  player?: RosterMember | null;
  label: string;
  teamLabel?: string;
  color: string;
  ink?: string;
  fallback?: string;
  onEdit?: () => void;
}
export interface MatchActionPitchProps {
  mode: 'goal' | 'penalty';
  primary: PitchParticipant;
  secondary: PitchParticipant;
  activeRole: 'primary' | 'secondary' | null;
  status: 'idle' | 'saving' | 'saved' | 'error';
  outcome?: PenaltyOutcome;
  animationKey?: string | number;
  visible?: boolean;
  disabled?: boolean;
  /** Initial shootout selection: show team bibs, without role slots or a ball. */
  teamPreview?: boolean;
  height?: number;
  celebrationColor?: string;
  onAnimationComplete?: () => void;
}

/** Physical coordinates shared by markings, slots, paths and the moving ball. */
const geometry = {
  goal: { primary: { x: 0.75, y: 0.44 }, secondary: { x: 0.25, y: 0.70 } },
  penalty: { primary: { x: 0.50, y: 0.63 }, secondary: { x: 0.50, y: 0.17 } },
};
const rtl = I18nManager.isRTL;
const logicalStart = (x: number, width: number, itemWidth: number) => rtl ? width - x - itemWidth / 2 : x - itemWidth / 2;

function Participant({ person, x, y, width, height, active, visible, disabled, dive = 0, concise = false }: {
  person: PitchParticipant; x: number; y: number; width: number; height: number; active: boolean; visible: boolean; disabled?: boolean; dive?: number; concise?: boolean;
}) {
  const reduced = useReducedMotion();
  const compact = height < 210;
  const discSize = concise ? (height < 145 ? 32 : 36) : compact ? 42 : 52;
  const slotWidth = compact ? 92 : 108;
  const halo = useSharedValue(0), entrance = useSharedValue(1), lunge = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(halo); halo.value = 0;
    if (visible && active && !reduced) halo.value = withRepeat(withSequence(withTiming(1, { duration: 900 }), withTiming(0, { duration: 900 })), -1, false);
    return () => cancelAnimation(halo);
  }, [visible, active, person.player?.id, reduced, halo]);
  useEffect(() => {
    cancelAnimation(entrance); entrance.value = person.player && visible && !reduced ? 0.86 : 1;
    if (person.player && visible && !reduced) entrance.value = withSpring(1, { damping: 17, stiffness: 230 });
    return () => cancelAnimation(entrance);
  }, [person.player?.id, visible, reduced, entrance]);
  useEffect(() => {
    cancelAnimation(lunge); lunge.value = 0;
    if (dive && visible && !reduced) lunge.value = withDelay(140, withSequence(withTiming(dive, { duration: 270 }), withTiming(0, { duration: 320 })));
    return () => cancelAnimation(lunge);
  }, [dive, visible, reduced, lunge]);
  const haloStyle = useAnimatedStyle(() => ({ opacity: 0.24 + halo.value * 0.30, transform: [{ scale: 1 + halo.value * 0.18 }] }));
  const avatarStyle = useAnimatedStyle(() => ({ transform: [{ scale: entrance.value }, { translateY: (1 - entrance.value) * 20 }, { translateX: lunge.value }] }));
  const filled = !!person.player || !!person.fallback;
  const editable = !!person.player && !!person.onEdit && !disabled;
  const content = <>
    <Animated.View style={[s.disc, avatarStyle, { width: discSize, height: discSize, borderRadius: discSize / 2, borderColor: person.color, backgroundColor: filled || active ? '#FFFFFF' : 'rgba(255,255,255,0.25)' }]}>
      {active && <Animated.View pointerEvents="none" style={[s.halo, { borderColor: person.color }, haloStyle]}/>}
      {person.player ? <UserAvatar user={person.player} size={discSize - 6}/> : <Text maxFontSizeMultiplier={1.1} style={[s.plus, compact && {fontSize:27,lineHeight:34}, { color: active || filled ? (person.ink ?? '#166534') : '#FFFFFF' }]}>{person.fallback ? '—' : '+'}</Text>}
      {editable && <View style={s.editDot}><Text style={s.editIcon}>✎</Text></View>}
    </Animated.View>
    <Text allowFontScaling={!concise} maxFontSizeMultiplier={1.15} style={[s.role,compact && s.compactLabel]} numberOfLines={1}>{concise && person.player ? `${person.label} · ⁨${person.player.name}⁩` : person.label}</Text>
    {!concise && <Text maxFontSizeMultiplier={1.15} style={[s.playerName,compact && s.compactLabel]} numberOfLines={1}>{person.player?.name ?? person.fallback ?? `בחירת ${person.label}`}</Text>}
    {person.teamLabel && <Text allowFontScaling={!concise} maxFontSizeMultiplier={1.15} style={[s.teamTag,compact && s.compactTeamTag, { backgroundColor: person.ink ?? '#14532D' }]} numberOfLines={1}>{person.teamLabel}</Text>}
  </>;
  const position = { width:slotWidth,start: logicalStart(x * width, width, slotWidth), top: y * height - discSize / 2 };
  return editable ? <Pressable onPress={person.onEdit} accessibilityRole="button" accessibilityLabel={`שינוי ${person.label}, ${person.player!.name}`} style={[s.participant, position]}>{content}</Pressable>
    : <View style={[s.participant, position]} accessible accessibilityLabel={`${person.label}, ${person.player?.name ?? person.fallback ?? 'טרם נבחר'}${person.teamLabel ? ', ' + person.teamLabel : ''}`}>{content}</View>;
}

/** A real moving ball; animation begins only once the event is acknowledged. */
export function MatchActionPitch({ mode, primary, secondary, activeRole, status, outcome = 'goal', animationKey, visible = true, disabled, teamPreview = false, height = 248, celebrationColor, onAnimationComplete }: MatchActionPitchProps) {
  const [width, setWidth] = useState(340);
  const reduced = useReducedMotion();
  const progress = useSharedValue(0), net = useSharedValue(0), celebration = useSharedValue(0);
  const callback = useRef(onAnimationComplete); callback.current = onAnimationComplete;
  const epoch = useRef(0);
  const hasPass = mode === 'goal' && !!secondary.player;
  const positions = height < 210 ? (mode === 'goal'
    ? {primary:{x:0.75,y:0.36},secondary:{x:0.25,y:0.52}}
    : {primary:{x:0.50,y:0.65},secondary:{x:0.50,y:0.13}}) : geometry[mode];
  const passStartY = positions.secondary.y - 0.11;
  const shotStartY = positions.primary.y - (mode === 'goal' || height < 210 ? 0.10 : 0.13);
  useEffect(() => {
    const current = ++epoch.current;
    cancelAnimation(progress); cancelAnimation(net); cancelAnimation(celebration);
    progress.value = 0; net.value = 0; celebration.value = 0;
    if (!visible || status !== 'saved') return;
    const finish = () => { if (epoch.current === current) callback.current?.(); };
    const duration = reduced ? 140 : hasPass ? 980 : 760;
    if (reduced) {
      progress.value = 1;
      celebration.value = withTiming(1, { duration: 140 });
    } else {
      progress.value = withTiming(1, { duration });
      net.value = outcome === 'goal' ? withDelay(duration - 210, withSequence(withTiming(1, { duration: 100 }), withSpring(0, { damping: 8 }))) : 0;
      celebration.value = withDelay(duration - 140, withTiming(1, { duration: 140 }));
    }
    const timer = setTimeout(finish, duration + (reduced ? 30 : 200));
    return () => { epoch.current += 1; clearTimeout(timer); cancelAnimation(progress); cancelAnimation(net); cancelAnimation(celebration); };
  }, [visible, status, animationKey, mode, outcome, hasPass, reduced, progress, net, celebration]);
  const ballStyle = useAnimatedStyle(() => {
    let x = mode === 'goal' ? (hasPass ? 0.25 : 0.75) : 0.5;
    let y = hasPass ? passStartY : shotStartY;
    const p = progress.value;
    if (mode === 'goal' && status !== 'saved') {
      // The ball waits with the assister throughout selection and pending saves.
      x = positions.secondary.x; y = passStartY;
    } else if (mode === 'goal' && hasPass && p < 0.44) {
      const u = p / 0.44; x = 0.25 + 0.50 * u; y = passStartY + (shotStartY - passStartY) * u - Math.sin(Math.PI * u) * 0.035;
    } else {
      const u = mode === 'goal' && hasPass ? (p - 0.44) / 0.56 : p;
      const startX = mode === 'goal' ? 0.75 : 0.50;
      const startY = shotStartY;
      const endX = outcome === 'miss' ? 0.96 : outcome === 'save' ? 0.44 : 0.50;
      const endY = outcome === 'miss' ? 0.07 : outcome === 'save' ? 0.20 : 0.10;
      x = startX + (endX - startX) * u; y = startY + (endY - startY) * u - Math.sin(Math.PI * u) * 0.035;
    }
    return { transform: [{ translateX: rtl ? width * (x - 1) + 12 : width * x - 12 }, { translateY: height * y - 12 }, { scale: 1 - p * 0.25 }, { rotate: `${p * 300}deg` }] };
  });
  const netStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: 1 + net.value * 0.045 }, { scaleY: 1 + net.value * 0.09 }] }));
  const celebrationStyle = useAnimatedStyle(() => ({ opacity: celebration.value, transform: [{ scale: reduced ? 1 : 0.90 + celebration.value * 0.10 }] }));
  const saved = visible && status === 'saved';
  return <View style={[s.pitch, { height }]} onLayout={event => setWidth(event.nativeEvent.layout.width)} testID="match-action-pitch">
    <Image source={require('@/assets/images/match-action-grass.png')} style={StyleSheet.absoluteFillObject} resizeMode="stretch" accessible={false}/>
    <View style={s.shade} pointerEvents="none"/>
    <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={StyleSheet.absoluteFillObject} accessible={false}>
      {Array.from({ length: 7 }, (_, i) => <Path key={i} d={`M${i * 14 - 20} 100 L${i * 8 + 12} 0 L${i * 8 + 20} 0 L${i * 14 - 6} 100Z`} fill={i % 2 ? '#082E17' : '#76B943'} opacity={0.14}/>)}
      <Path d="M0 18 H100 M36 18 L33 31 H67 L64 18 M19 18 L9 48 H91 L81 18 M33 48 Q50 63 67 48 M30 100 Q50 82 70 100" stroke="#FFFFFF" strokeWidth={0.6} opacity={0.80} fill="none"/>
      <Circle cx="50" cy="39" r="0.65" fill="#FFF" opacity={0.8}/>
      {mode === 'goal' && primary.player && <Path d={`M25 ${passStartY*100} Q50 ${passStartY*100-2} 75 ${shotStartY*100} L50 10`} stroke="#E5FFEF" strokeDasharray="2.2 1.6" strokeWidth={0.65} fill="none" opacity={0.82}/>}
    </Svg>
    <Animated.View pointerEvents="none" style={[s.goal, { width: width * 0.32, height: height * 0.15, start: logicalStart(width * 0.5, width, width * 0.32), top: height * 0.035 }, netStyle]}>
      <Svg width="100%" height="100%" viewBox="0 0 160 60" preserveAspectRatio="none" accessible={false}>
        <Path d="M2 58 L12 4 H148 L158 58Z" fill="rgba(255,255,255,0.08)" stroke="#DFF7E9" strokeWidth={2}/>
        {Array.from({ length: 21 }, (_, i) => <Path key={i} d={`M${12 + i * 6.8} 4 L${2 + i * 7.8} 58`} stroke="#DFF7E9" strokeWidth={0.6} opacity={0.72}/>)}
        {Array.from({ length: 10 }, (_, i) => <Path key={i} d={`M${12 - i} ${4 + i * 5.4} H${148 + i}`} stroke="#DFF7E9" strokeWidth={0.65} opacity={0.72}/>)}
        <Path d="M2 58 V2 H158 V58" stroke="#FFFFFF" strokeWidth={3.2} fill="none"/>
      </Svg>
    </Animated.View>
    {teamPreview ? <View pointerEvents="none" accessible={false} style={s.previewShirts}><TeamShirtIllustration color={primary.color} width={height < 180 ? 42 : 58}/><TeamShirtIllustration color={secondary.color} width={height < 180 ? 42 : 58}/></View> : <>
    <Participant person={primary} {...positions.primary} width={width} height={height} active={activeRole === 'primary' && status === 'idle'} visible={visible} disabled={disabled} concise={mode === 'penalty' && height < 210}/>
    <Participant person={secondary} {...positions.secondary} width={width} height={height} active={activeRole === 'secondary' && status === 'idle'} visible={visible} disabled={disabled} concise={mode === 'penalty' && height < 210} dive={mode === 'penalty' && saved ? (outcome === 'save' ? -22 : 15) : 0}/>
    </>}
    {!teamPreview && visible && (mode === 'penalty' || saved) && <Animated.View testID="match-action-ball" pointerEvents="none" accessible={false} style={[s.ball, ballStyle]}>
      <Image source={require('@/assets/images/match-football.png')} style={s.ballImage} resizeMode="contain" accessible={false}/>
    </Animated.View>}
    {saved && <Animated.View pointerEvents="none" style={[s.celebration, { backgroundColor: celebrationColor ?? primary.ink ?? '#166534' }, celebrationStyle]} accessibilityLiveRegion="polite">
      <Text style={s.celebrationText}>{outcome === 'goal' ? 'גול!' : outcome === 'save' ? 'עצירה!' : 'מחוץ למסגרת'}</Text>
    </Animated.View>}
  </View>;
}
const s = StyleSheet.create({
  pitch: { overflow: 'hidden', borderRadius: 18, backgroundColor: '#237233', width: '100%' }, shade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(3,41,18,0.17)' },
  goal: { position: 'absolute' }, participant: { position: 'absolute', width: 108, alignItems: 'center', gap: 1 },
  previewShirts: { position: 'absolute', start: 0, end: 0, bottom: '12%', flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center' },
  disc: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: 64, height: 64, borderRadius: 32, borderWidth: 2 }, plus: { fontSize: 31, fontWeight: '600', lineHeight: 40, textAlign: 'center' },
  role: { color: '#FFF', fontSize: 12, fontWeight: '800', textAlign: 'center', textShadowColor: '#103A20', textShadowRadius: 2 },
  playerName: { color: '#FFF', fontSize: 12, fontWeight: '700', textAlign: 'center', textShadowColor: '#103A20', textShadowRadius: 2, maxWidth: 108 },
  teamTag: { color: '#FFF', fontSize: 10, fontWeight: '700', textAlign: 'center', paddingHorizontal: 7, paddingVertical: 1, borderRadius: 8, maxWidth: 108 },
  compactLabel:{fontSize:11,lineHeight:14,includeFontPadding:false},compactTeamTag:{fontSize:9,lineHeight:12,includeFontPadding:false},
  editDot: { position: 'absolute', bottom: -1, end: -4, width: 18, height: 18, borderRadius: 9, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center' }, editIcon: { color: '#172554', fontSize: 14 },
  ball: { position: 'absolute', start: 0, top: 0, width: 24, height: 24 },
  ballImage: { width: 24, height: 24 },
  celebration: { position: 'absolute', top: '30%', start: '31%', end: '31%', borderRadius: 14, paddingVertical: 7, paddingHorizontal: 6, borderWidth: 1, borderColor: '#FFFFFF80' },
  celebrationText: { color: '#FFF', fontSize: 23, fontWeight: '900', textAlign: 'center' },
});
