import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute } from '@react-navigation/native';
import { colors, font, radius } from '../theme';
import { EmbeddedScreen } from './ui';

export interface WorkspaceSection { key: string; label: string; component: React.ComponentType; }
export function Workspace({ title, sections }: { title: string; sections: WorkspaceSection[] }) {
  const route = useRoute();
  const params = route.params as { section?: string; sectionRequest?: number } | undefined;
  const requested = params?.section;
  const initial = sections.some(s => s.key === requested) ? requested! : sections[0].key;
  const [selected, setSelected] = useState(initial);
  const [visited, setVisited] = useState(() => new Set([initial]));
  const select = (key: string) => { setSelected(key); setVisited(v => new Set([...v, key])); };
  useEffect(() => { if (requested && sections.some(s => s.key === requested)) select(requested); }, [requested, params?.sectionRequest, sections]);
  return <SafeAreaView edges={['top']} style={s.screen}>
    <Text style={[font.h1, s.title]}>{title}</Text>
    <View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs}>
      {sections.map(section => <Pressable key={section.key} onPress={() => select(section.key)} accessibilityRole="tab" accessibilityState={{ selected: selected === section.key }} style={[s.tab, selected === section.key && s.active]}>
        <Text style={[font.body, selected === section.key && { color: colors.primary, fontWeight: '700' }]}>{section.label}</Text>
      </Pressable>)}
    </ScrollView></View>
    <EmbeddedScreen.Provider value={true}><View style={{ flex: 1 }}>
      {sections.filter(section => visited.has(section.key)).map(({ key, component: Body }) => <View key={key} style={[s.page, selected !== key && { display: 'none' }]} accessibilityElementsHidden={selected !== key} importantForAccessibility={selected === key ? 'auto' : 'no-hide-descendants'}><Body /></View>)}
    </View></EmbeddedScreen.Provider>
  </SafeAreaView>;
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg }, title: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 16 },
  tabs: { flexDirection: 'row', direction: 'rtl' as const, paddingHorizontal: 18, gap: 8, paddingBottom: 8 },
  tab: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderRadius: radius.sm, backgroundColor: colors.surface },
  active: { backgroundColor: colors.primarySoft, borderBottomWidth: 2, borderBottomColor: colors.primary },
  page: { position: 'absolute', inset: 0 },
});
