import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, I18nManager, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { RTL_LABEL_ALIGN } from '@/theme';
import { FormSectionHeader } from '@/components/FormSectionHeader';
import { useReducedMotion } from '@/hooks/animations/useReducedMotion';

export { FormDesignContext, FORM_BG, FORM_BLUE } from './FormTheme';
import { FORM_BG, FORM_BLUE } from './FormTheme';
import { WizardFootball } from './WizardFootball';

export function FormProgress({ current, labels }: { current: number; labels: string[] }) {
  const reducedMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const position = useRef(new Animated.Value(current - 1)).current;
  const stride = labels.length ? width / labels.length : 0;
  const direction = I18nManager.isRTL ? -1 : 1;
  useEffect(() => {
    position.stopAnimation();
    if (reducedMotion) position.setValue(current - 1);
    else Animated.timing(position, {
      toValue: current - 1, duration: 650,
      easing: Easing.inOut(Easing.cubic), useNativeDriver: true,
    }).start();
    return () => position.stopAnimation();
  }, [current, position, reducedMotion]);
  const range = Math.max(1, labels.length - 1);
  const translateX = position.interpolate({ inputRange: [0, range], outputRange: [0, range * stride * direction] });
  const rotate = position.interpolate({ inputRange: [0, range], outputRange: ['0deg', `${range * stride / (Math.PI * 36) * 360 * direction}deg`] });
  return <View style={s.progress}>
    <View style={s.progressTrack} onLayout={e => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && labels.length > 1 ? <View pointerEvents="none" style={[s.connector, { start: stride / 2, width: stride * (labels.length - 1) }]} /> : null}
      {labels.map((label, i) => <View key={label} style={s.step} accessible accessibilityLabel={`${label}, שלב ${i + 1} מתוך ${labels.length}`} accessibilityState={{ selected: current === i + 1 }}>
        <WizardFootball color="#AFBED5" />
        <Text style={[s.stepText, current === i + 1 && s.activeText]}>{label}</Text>
      </View>)}
      {width > 0 ? <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[s.rollingBall, { start: stride / 2 - 18, transform: [{ translateX }, { rotate }] }]}>
        <WizardFootball color={FORM_BLUE} />
      </Animated.View> : null}
    </View>
  </View>;
}

export function FormIntro({ children }: { children: React.ReactNode }) {
  return <View style={s.intro}>
    <View pointerEvents="none" style={s.pitch}>
      <Svg width={60} height={38} viewBox="0 0 100 64">
        <Rect x={2} y={2} width={96} height={60} rx={2} fill="none" stroke="#C6DAFB" strokeWidth={1.5} />
        <Path d="M50 2V62M2 19H17V45H2M98 19H83V45H98" fill="none" stroke="#C6DAFB" strokeWidth={1.5} />
        <Circle cx={50} cy={32} r={11} fill="none" stroke="#C6DAFB" strokeWidth={1.5} />
      </Svg>
    </View>
    <Text style={s.introText}>{children}</Text>
  </View>;
}

// Keep each field's original key/path while grouping existing section boundaries.
// Fragments are transparent; custom controls and conditional visibility stay intact.
export function FormStandalone({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function FormSections({ children }: { children: React.ReactNode }) {
  const nodes: React.ReactElement[] = [];
  function flatten(items: React.ReactNode, prefix: string) {
    React.Children.forEach(items, (child, index) => {
      if (!React.isValidElement<{ children?: React.ReactNode; title?: string }>(child)) return;
      const key = `${prefix}/${child.key ?? index}`;
      if (child.type === React.Fragment) flatten(child.props.children, key);
      else nodes.push(React.cloneElement(child, { key }));
    });
  }
  flatten(children, 'fields');
  const groups: { key: string; title?: string; nodes: React.ReactElement[]; standalone?: boolean }[] = [];
  for (const node of nodes) {
    if (node.type === FormStandalone) groups.push({ key: String(node.key), nodes: [node], standalone: true });
    else if (node.type === FormSectionHeader) groups.push({ key: String((node.props as { title: string }).title), title: (node.props as { title: string }).title, nodes: [] });
    else {
      if (!groups.length) groups.push({ key: 'first', nodes: [] });
      groups[groups.length - 1].nodes.push(node);
    }
  }
  return <View style={s.sections}>{groups.filter(group => group.nodes.length).map(group => group.standalone ? <React.Fragment key={group.key}>{group.nodes}</React.Fragment> : <View key={group.key} style={s.card}>
    {group.title ? <View style={s.heading}><Text style={s.title}>{group.title}</Text><Ionicons name={sectionIcon(group.title)} color={FORM_BLUE} size={20} /></View> : null}
    {group.nodes}
  </View>)}</View>;
}

function sectionIcon(title: string): keyof typeof Ionicons.glyphMap {
  if (/מיקום|מקום/.test(title)) return 'location-outline';
  if (/דירוג/.test(title)) return 'stats-chart-outline';
  if (/כרטיס|משמעת/.test(title)) return 'card-outline';
  if (/זמינות|זמן/.test(title)) return 'calendar-outline';
  if (/פורמט|אופן/.test(title)) return 'football-outline';
  if (/הצטרפות|מאפייני/.test(title)) return 'people-outline';
  if (/חשיפה|נראות/.test(title)) return 'megaphone-outline';
  return 'document-text-outline';
}

const s = StyleSheet.create({
  progress: { paddingHorizontal: 32, paddingVertical: 12, backgroundColor: FORM_BG },
  progressTrack: { flexDirection: 'row', position: 'relative' },
  connector: { position: 'absolute', top: 17, height: 2, backgroundColor: '#C7D9F7' },
  step: { flex: 1, alignItems: 'center', gap: 7 },
  active: { backgroundColor: FORM_BLUE, borderColor: FORM_BLUE },
  stepText: { fontSize: 14, fontWeight: '600', color: '#64748B' },
  activeText: { color: '#101D46', fontWeight: '800' },
  rollingBall: { position: 'absolute', top: 0, width: 36, height: 36 },
  intro: { justifyContent: 'center', marginBottom: 10 },
  introText: { fontSize: 14, lineHeight: 22, color: '#526482', textAlign: RTL_LABEL_ALIGN, paddingEnd: 64 },
  pitch: { position: 'absolute', end: 0, top: -5, opacity: 0.65, transform: [{ rotate: '-17deg' }] },
  sections: { gap: 16 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: '#E8EEF8', padding: 16, gap: 16, shadowColor: '#3C6096', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  title: { fontSize: 17, fontWeight: '800', color: '#101D46', textAlign: RTL_LABEL_ALIGN, flexShrink: 1 },
});
