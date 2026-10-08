// FeaturesBody — the "פיצרים" segment of the unified Dev Inbox. Jot free text,
// attach screenshots, tag bug vs feature, track status (new/in-progress/done).
// Claude reads `pulseFeatures` on demand and implements the open ones.
// Self-scrolling (no Screen header) so it sits under the shared segmented control.

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
import { Card, Empty } from '../components/ui';
import {
  listFeatures,
  createFeature,
  setFeatureStatus,
  deleteFeature,
  type FeatureItem,
  type FeatureKind,
  type FeatureStatus,
} from '../services/featuresService';

const MAX_IMAGES = 6;

const STATUS_META: Record<FeatureStatus, { label: string; color: string }> = {
  new: { label: 'חדש', color: colors.primary },
  'in-progress': { label: 'בעבודה', color: colors.amber },
  done: { label: 'בוצע', color: colors.green },
};
const STATUS_ORDER: FeatureStatus[] = ['new', 'in-progress', 'done'];
const dataUri = (b64: string) => `data:image/jpeg;base64,${b64}`;

export function FeaturesBody() {
  const [items, setItems] = useState<FeatureItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // ── compose state ──
  const [kind, setKind] = useState<FeatureKind>('feature');
  const [text, setText] = useState('');
  const [imgs, setImgs] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await listFeatures());
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
        // Downscale so several screenshots fit under the 1MB doc limit.
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
      Alert.alert('חסר תוכן', 'כתוב טקסט או צרף תמונה.');
      return;
    }
    setSaving(true);
    const ok = await createFeature({
      kind,
      text: text.trim(),
      images: imgs,
      now: Date.now(),
    });
    setSaving(false);
    if (!ok) {
      Alert.alert('שמירה נכשלה', 'נסה שוב.');
      return;
    }
    setText('');
    setImgs([]);
    setKind('feature');
    load();
  };

  const cycleStatus = async (it: FeatureItem) => {
    const next =
      STATUS_ORDER[(STATUS_ORDER.indexOf(it.status) + 1) % STATUS_ORDER.length];
    setItems((prev) =>
      prev.map((x) => (x.id === it.id ? { ...x, status: next } : x)),
    );
    const ok = await setFeatureStatus(it.id, next);
    if (!ok) load(); // revert from source on failure
  };

  const remove = (it: FeatureItem) =>
    Alert.alert('למחוק?', 'הפריט יימחק לצמיתות.', [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'מחק',
        style: 'destructive',
        onPress: async () => {
          setItems((prev) => prev.filter((x) => x.id !== it.id));
          await deleteFeature(it.id);
        },
      },
    ]);

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={s.scroll}
      showsVerticalScrollIndicator={false}
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
        <View style={s.kindRow}>
          {(['feature', 'bug'] as FeatureKind[]).map((k) => {
            const active = kind === k;
            const tint = k === 'bug' ? colors.red : colors.primary;
            return (
              <Pressable
                key={k}
                onPress={() => setKind(k)}
                style={[
                  s.kindPill,
                  active && { backgroundColor: tint, borderColor: tint },
                ]}
              >
                <Ionicons
                  name={k === 'bug' ? 'bug' : 'bulb'}
                  size={15}
                  color={active ? '#fff' : tint}
                />
                <Text style={[s.kindTxt, active && { color: '#fff' }]}>
                  {k === 'bug' ? 'באג' : 'פיצר'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="מה לבנות / מה לתקן? כתוב חופשי…"
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
          <Pressable
            style={[s.saveBtn, saving && { opacity: 0.6 }]}
            onPress={save}
            disabled={saving}
          >
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
        <Empty text="אין עדיין פריטים — הוסף את הראשון 👆" />
      ) : (
        items.map((it) => {
          const sm = STATUS_META[it.status];
          const isBug = it.kind === 'bug';
          return (
            <Card key={it.id} style={s.item}>
              <View style={s.itemHead}>
                <View
                  style={[
                    s.kindTag,
                    { backgroundColor: (isBug ? colors.red : colors.primary) + '22' },
                  ]}
                >
                  <Ionicons
                    name={isBug ? 'bug' : 'bulb'}
                    size={12}
                    color={isBug ? colors.red : colors.primary}
                  />
                  <Text
                    style={[s.kindTagTxt, { color: isBug ? colors.red : colors.primary }]}
                  >
                    {isBug ? 'באג' : 'פיצר'}
                  </Text>
                </View>
                <View style={{ flex: 1 }} />
                <Pressable
                  onPress={() => cycleStatus(it)}
                  style={[s.statusPill, { borderColor: sm.color }]}
                >
                  <View style={[s.statusDot, { backgroundColor: sm.color }]} />
                  <Text style={[s.statusTxt, { color: sm.color }]}>{sm.label}</Text>
                </Pressable>
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
            </Card>
          );
        })
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 14, paddingBottom: 36, gap: 10 },
  compose: { gap: 12, marginBottom: 6 },
  kindRow: { flexDirection: 'row-reverse', gap: 8 },
  kindPill: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  kindTxt: { ...font.small, color: colors.textSoft, fontWeight: '700' },
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

  item: { gap: 10, marginBottom: 10 },
  itemHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  kindTag: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  kindTagTxt: { fontSize: 12, fontWeight: '800' },
  statusPill: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusTxt: { fontSize: 12, fontWeight: '800' },
  del: { padding: 4 },
  itemText: { ...font.body, color: colors.text, lineHeight: 20 },
  itemImg: {
    width: 120,
    height: 120,
    borderRadius: radius.sm,
    marginEnd: 8,
    backgroundColor: colors.surfaceAlt,
  },
});
