// StickersScreen — the physical sticker-campaign map. Paste a WhatsApp/Google-
// Maps location (link or raw coords) → a pin drops at that spot. The whole of
// Israel is shown; pinch to zoom to street level and see exactly where each
// sticker was stuck. Tap a pin to remove it.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Alert,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';

import { Screen, Card } from '../components/ui';
import { MapWebView, type MapMarker } from '../components/MapWebView';
import { colors, radius, space } from '../theme';
import {
  fetchStickers,
  addSticker,
  deleteSticker,
  parseLocationInput,
  inIsrael,
  type Sticker,
} from '../services/stickers';

const ISRAEL_CENTER = { lat: 31.6, lng: 34.9 };

export function StickersScreen() {
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [focus, setFocus] = useState<{ lat: number; lng: number; zoom?: number } | null>(
    null,
  );

  const load = useCallback(async () => {
    setStickers(await fetchStickers());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(
    async (loc: { lat: number; lng: number }) => {
      const id = await addSticker({ lat: loc.lat, lng: loc.lng });
      if (!id) {
        Alert.alert('שמירה נכשלה', 'נסה שוב.');
        return;
      }
      setInput('');
      await load();
      setFocus({ lat: loc.lat, lng: loc.lng, zoom: 15 });
    },
    [load],
  );

  const onAdd = useCallback(async () => {
    if (!input.trim() || busy) return;
    setBusy(true);
    try {
      const loc = await parseLocationInput(input);
      if (!loc) {
        Alert.alert(
          'לא זוהה מיקום',
          'הדבק מיקום מווטסאפ, קישור Google Maps, או קואורדינטות (‎lat, lng‎).',
        );
        return;
      }
      if (!inIsrael(loc.lat, loc.lng)) {
        Alert.alert(
          'מחוץ לישראל?',
          `המיקום (${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}) נראה מחוץ לישראל. להוסיף בכל זאת?`,
          [
            { text: 'ביטול', style: 'cancel' },
            { text: 'הוסף', onPress: () => save(loc) },
          ],
        );
        return;
      }
      await save(loc);
    } finally {
      setBusy(false);
    }
  }, [input, busy, save]);

  const onMarker = useCallback(
    (id: string) => {
      const s = stickers.find((x) => x.id === id);
      if (!s) return;
      Alert.alert('מדבקה', `${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}`, [
        { text: 'סגור', style: 'cancel' },
        {
          text: 'מחק',
          style: 'destructive',
          onPress: async () => {
            setStickers((prev) => prev.filter((x) => x.id !== id));
            await deleteSticker(id);
          },
        },
      ]);
    },
    [stickers],
  );

  const onCluster = useCallback((ids: string[]) => {
    Alert.alert('מדבקות כאן', `${ids.length} מדבקות הודבקו במקום הזה.`);
  }, []);

  const markers: MapMarker[] = stickers.map((s) => ({
    id: s.id,
    lat: s.lat,
    lng: s.lng,
  }));

  return (
    <Screen title="מדבקות 🗺️" subtitle={`${stickers.length} מדבקות על המפה`} scroll={false}>
      <Card style={styles.inputCard}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="הדבק כאן מיקום מווטסאפ / קישור Google Maps / קואורדינטות"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          multiline
          textAlign="right"
          editable={!busy}
        />
        <Pressable
          onPress={onAdd}
          disabled={busy || !input.trim()}
          style={[styles.addBtn, (busy || !input.trim()) && { opacity: 0.5 }]}
        >
          {busy ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.addText}>הוסף מדבקה 📍</Text>
          )}
        </Pressable>
      </Card>

      <View style={styles.mapWrap}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <MapWebView
            markers={markers}
            center={ISRAEL_CENTER}
            zoom={7}
            focusOn={focus}
            onMarkerPress={onMarker}
            onClusterPress={onCluster}
          />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  inputCard: { gap: space(2) },
  input: {
    color: colors.text,
    fontSize: 14,
    minHeight: 44,
    maxHeight: 110,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    writingDirection: 'rtl',
  },
  addBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingVertical: space(3),
    alignItems: 'center',
    justifyContent: 'center',
  },
  addText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  mapWrap: {
    flex: 1,
    marginTop: space(3),
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
