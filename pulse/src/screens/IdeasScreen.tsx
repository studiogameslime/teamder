// IdeasScreen — a backlog for product ideas. Jot free text (+ optional
// screenshots) and move each idea through three statuses: רעיון (parked) →
// לאיפיון (Claude should spec it) → לביצוע (spec approved, ready to build).
// Once a spec is approved Claude records it on the idea (shown under it).
// Reads/writes `pulseIdeas`.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import { colors, font, radius } from '../theme';
import { Card, Empty, Screen } from '../components/ui';
import {
  listIdeas,
  createIdea,
  setIdeaStatus,
  deleteIdea,
  type IdeaItem,
  type IdeaStatus,
} from '../services/ideasService';

const MAX_IMAGES = 6;
const dataUri = (b64: string) => `data:image/jpeg;base64,${b64}`;

const STATUS_META: Record<
  IdeaStatus,
  { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  idea: { label: 'רעיון', color: colors.textMuted, icon: 'bulb-outline' },
  spec: { label: 'לאיפיון', color: colors.amber, icon: 'document-text-outline' },
  build: { label: 'לביצוע', color: colors.green, icon: 'construct' },
  done: { label: 'בוצע', color: colors.textMuted, icon: 'checkmark-done' },
};
// Tap cycles forward through this order…
const ORDER: IdeaStatus[] = ['idea', 'spec', 'build', 'done'];
// …but the LIST sorts actionable-first (build → spec → idea), matching
// ideasService so the optimistic order doesn't jump on the next refresh.
const RANK: Record<IdeaStatus, number> = { build: 0, spec: 1, idea: 2, done: 3 };

export function IdeasScreen() {
  const [items, setItems] = useState<IdeaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [text, setText] = useState('');
  const [imgs, setImgs] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await listIdeas(true));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const pickImages = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('דרושה הרשאה', 'אשר גישה לגלריה כדי לצרף תמונות.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: MAX_IMAGES,
      quality: 1,
    });
    if (res.canceled) return;
    const next: string[] = [];
    for (const a of res.assets) {
      try {
        const m = await manipulateAsync(a.uri, [{ resize: { width: 1000 } }], {
          compress: 0.5,
          format: SaveFormat.JPEG,
          base64: true,
        });
        if (m.base64) next.push(m.base64);
      } catch {
        /* skip a bad image */
      }
    }
    setImgs((prev) => [...prev, ...next].slice(0, MAX_IMAGES));
  };

  const save = async () => {
    if (!text.trim() && imgs.length === 0) {
      Alert.alert('חסר תוכן', 'כתוב רעיון או צרף תמונה.');
      return;
    }
    setSaving(true);
    const ok = await createIdea({ text: text.trim(), images: imgs, now: Date.now() });
    setSaving(false);
    if (!ok) {
      Alert.alert('שמירה נכשלה', 'נסה שוב.');
      return;
    }
    setText('');
    setImgs([]);
    load();
  };

  // Cycle רעיון → לאיפיון → לביצוע → בוצע → רעיון.
  const cycleStatus = async (it: IdeaItem) => {
    const next = ORDER[(ORDER.indexOf(it.status) + 1) % ORDER.length];
    setItems((prev) =>
      prev
        .map((x) => (x.id === it.id ? { ...x, status: next } : x))
        .sort((a, b) => RANK[a.status] - RANK[b.status] || b.createdAt - a.createdAt),
    );
    const ok = await setIdeaStatus(it.id, next);
    if (!ok) load();
  };

  const toggleSpec = (id: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const remove = (it: IdeaItem) =>
    Alert.alert('למחוק?', 'הרעיון יימחק לצמיתות.', [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'מחק',
        style: 'destructive',
        onPress: async () => {
          setItems((prev) => prev.filter((x) => x.id !== it.id));
          await deleteIdea(it.id);
        },
      },
    ]);

  const buildCount = items.filter((i) => i.status === 'build').length;
  const specCount = items.filter((i) => i.status === 'spec').length;
  const doneCount = items.filter((i) => i.status === 'done').length;
  const subtitle =
    buildCount + specCount > 0
      ? [buildCount ? `${buildCount} לביצוע` : '', specCount ? `${specCount} לאיפיון` : '']
          .filter(Boolean)
          .join(' · ')
      : doneCount
        ? `${items.length - doneCount} פתוחים · ${doneCount} בוצעו`
        : 'מאגר רעיונות לפיתוח עתידי';

  return (
    <Screen
      title="רעיונות"
      subtitle={subtitle}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
          tintColor={colors.primary}
        />
      }
    >
      {/* ── Compose ── */}
      <Card style={s.compose}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="רעיון חדש… (יישמר כ׳רעיון׳; סמן ׳לאיפיון׳ כשתרצה שאאפיין)"
          placeholderTextColor={colors.textMuted}
          style={s.input}
          multiline
          textAlign="right"
        />

        {imgs.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.thumbs}>
            {imgs.map((b64, i) => (
              <View key={i} style={s.thumbWrap}>
                <Image source={{ uri: dataUri(b64) }} style={s.thumb} />
                <Pressable
                  style={s.thumbX}
                  onPress={() => setImgs((prev) => prev.filter((_, j) => j !== i))}
                  hitSlop={8}
                >
                  <Ionicons name="close" size={14} color="#fff" />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        ) : null}

        <View style={s.actions}>
          <Pressable style={s.addImg} onPress={pickImages} disabled={imgs.length >= MAX_IMAGES}>
            <Ionicons name="image" size={18} color={colors.primary} />
            <Text style={s.addImgTxt}>
              {imgs.length >= MAX_IMAGES ? 'מקס׳ תמונות' : 'הוסף תמונה'}
            </Text>
          </Pressable>
          <Pressable style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
            {saving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={s.saveTxt}>שמור</Text>
            )}
          </Pressable>
        </View>
      </Card>

      {/* ── List ── */}
      {loading ? (
        <View style={{ paddingVertical: 40 }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : items.length === 0 ? (
        <Empty text="אין עדיין רעיונות — הוסף את הראשון 👆" />
      ) : (
        items.map((it) => {
          const sm = STATUS_META[it.status];
          const open = expanded.has(it.id);
          return (
            <Card key={it.id} style={[s.item, it.status !== 'idea' && { borderWidth: 1, borderColor: sm.color + '55' }]}>
              {it.status !== 'idea' ? <View style={[s.accent, { backgroundColor: sm.color }]} /> : null}
              <View style={s.itemHead}>
                <Pressable
                  onPress={() => cycleStatus(it)}
                  style={[
                    s.statusPill,
                    { borderColor: sm.color },
                    it.status === 'build' && { backgroundColor: colors.green },
                    it.status === 'spec' && { backgroundColor: colors.amber + '22' },
                  ]}
                >
                  <Ionicons
                    name={sm.icon}
                    size={14}
                    color={it.status === 'build' ? '#fff' : sm.color}
                  />
                  <Text style={[s.statusTxt, { color: it.status === 'build' ? '#fff' : sm.color }]}>
                    {sm.label}
                  </Text>
                </Pressable>
                <View style={{ flex: 1 }} />
                <Pressable onPress={() => remove(it)} hitSlop={8} style={s.del}>
                  <Ionicons name="trash-outline" size={16} color={colors.textMuted} />
                </Pressable>
              </View>

              {it.text ? <Text style={s.itemText}>{it.text}</Text> : null}

              {it.images.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {it.images.map((b64, i) => (
                    <Image key={i} source={{ uri: dataUri(b64) }} style={s.itemImg} />
                  ))}
                </ScrollView>
              ) : null}

              {it.spec ? (
                <View style={s.specWrap}>
                  <Pressable onPress={() => toggleSpec(it.id)} style={s.specHead}>
                    <Ionicons
                      name={open ? 'chevron-down' : 'chevron-back'}
                      size={15}
                      color={colors.primary}
                    />
                    <Ionicons name="document-text" size={14} color={colors.primary} />
                    <Text style={s.specHeadTxt}>איפיון</Text>
                  </Pressable>
                  {open ? <Text style={s.specText}>{it.spec}</Text> : null}
                </View>
              ) : null}
            </Card>
          );
        })
      )}

      {/* Breathing room so the last card's "איפיון" expander clears the tab bar. */}
      <View style={{ height: 48 }} />
    </Screen>
  );
}

const s = StyleSheet.create({
  compose: { gap: 12, marginBottom: 6 },
  input: {
    ...font.body,
    color: colors.text,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    minHeight: 84,
    textAlignVertical: 'top',
    writingDirection: 'rtl',
  },
  thumbs: { flexGrow: 0 },
  thumbWrap: { marginEnd: 8, position: 'relative' },
  thumb: { width: 72, height: 72, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  thumbX: {
    position: 'absolute',
    top: -6,
    left: -6,
    backgroundColor: colors.red,
    borderRadius: 10,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  addImg: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  addImgTxt: { ...font.small, color: colors.primary, fontWeight: '700' },
  saveBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },

  item: { gap: 10, marginBottom: 10, overflow: 'hidden' },
  accent: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 3 },
  itemHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  statusPill: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusTxt: { fontSize: 12, fontWeight: '800' },
  del: { padding: 4 },
  itemText: { ...font.body, color: colors.text, lineHeight: 21, textAlign: 'right' },
  itemImg: {
    width: 120,
    height: 120,
    borderRadius: radius.sm,
    marginEnd: 8,
    backgroundColor: colors.surfaceAlt,
  },
  specWrap: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
    gap: 8,
  },
  specHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  specHeadTxt: { ...font.small, color: colors.primary, fontWeight: '800' },
  specText: {
    ...font.small,
    color: colors.textSoft,
    lineHeight: 20,
    textAlign: 'right',
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    padding: 10,
  },
});
