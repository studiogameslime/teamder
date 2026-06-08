// LocationSearchSheet — full-screen location picker for the game wizard.
// Replaces the inline autocomplete dropdown (which the keyboard + banner ad
// used to cover). Flow: type → clear results list above the keyboard →
// tap a result → confirm on a small map → return. Free-typed text is also
// allowed (returns without coords) so a place that isn't in govmap still works.

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { MapWebView } from '@/components/map/MapWebView';
import { searchPlaces, type GovmapPlace } from '@/services/govmapService';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

export interface LocationResult {
  label: string;
  lat?: number;
  lng?: number;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (result: LocationResult) => void;
  initialQuery?: string;
}

export function LocationSearchSheet({ visible, onClose, onSelect, initialQuery }: Props) {
  const [query, setQuery] = useState(initialQuery ?? '');
  const [results, setResults] = useState<GovmapPlace[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<GovmapPlace | null>(null);
  const inputRef = useRef<TextInput>(null);

  // Reset to a clean search each time the sheet opens.
  useEffect(() => {
    if (visible) {
      setQuery(initialQuery ?? '');
      setResults([]);
      setPicked(null);
      const t = setTimeout(() => inputRef.current?.focus(), 250);
      return () => clearTimeout(t);
    }
  }, [visible, initialQuery]);

  // Debounced search.
  useEffect(() => {
    if (!visible || picked) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await searchPlaces(q);
        if (alive) setResults(r);
      } catch {
        if (alive) setResults([]);
      } finally {
        if (alive) setLoading(false);
      }
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, visible, picked]);

  const useFreeText = () => {
    const q = query.trim();
    if (!q) return;
    onSelect({ label: q });
    onClose();
  };
  const confirmPicked = () => {
    if (!picked) return;
    onSelect({ label: picked.label, lat: picked.lat, lng: picked.lng });
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
            <Ionicons name="close" size={26} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>{he.locationSearchTitle}</Text>
          <View style={{ width: 26 }} />
        </View>

        {picked ? (
          // ── Confirm step: map + selected label ──
          <View style={styles.confirmWrap}>
            <View style={styles.mapBox}>
              <MapWebView
                markers={[{ id: 'sel', lat: picked.lat, lng: picked.lng }]}
                center={{ lat: picked.lat, lng: picked.lng }}
                zoom={15}
              />
            </View>
            <View style={styles.confirmBody}>
              <Ionicons name="location" size={22} color={colors.primary} />
              <Text style={styles.pickedLabel}>{picked.label}</Text>
            </View>
            <Pressable style={styles.primaryBtn} onPress={confirmPicked}>
              <Text style={styles.primaryBtnText}>{he.locationConfirm}</Text>
            </Pressable>
            <Pressable style={styles.secondaryBtn} onPress={() => setPicked(null)}>
              <Text style={styles.secondaryBtnText}>{he.locationSearchAgain}</Text>
            </Pressable>
          </View>
        ) : (
          // ── Search step: input + results ──
          <>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={20} color={colors.textMuted} />
              <TextInput
                ref={inputRef}
                value={query}
                onChangeText={setQuery}
                placeholder={he.createGameFieldPlaceholder}
                placeholderTextColor="#9CA3AF"
                style={styles.searchInput}
                textAlign="right"
                autoCorrect={false}
                returnKeyType="search"
                onSubmitEditing={useFreeText}
              />
              {query.length > 0 ? (
                <Pressable onPress={() => setQuery('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                </Pressable>
              ) : null}
            </View>

            <View style={styles.results}>
              {/* Free-text option — always available so a place not in govmap still works. */}
              {query.trim().length > 0 ? (
                <Pressable style={styles.freeRow} onPress={useFreeText}>
                  <Ionicons name="create-outline" size={20} color={colors.primary} />
                  <Text style={styles.freeText} numberOfLines={1}>
                    {he.locationUseTyped(query.trim())}
                  </Text>
                </Pressable>
              ) : null}

              {loading ? (
                <View style={styles.center}>
                  <ActivityIndicator color={colors.primary} />
                </View>
              ) : (
                results.map((p, i) => (
                  <Pressable key={`${p.label}-${i}`} style={styles.resultRow} onPress={() => setPicked(p)}>
                    <Ionicons name="location-outline" size={20} color={colors.textMuted} />
                    <Text style={styles.resultText} numberOfLines={2}>
                      {p.label}
                    </Text>
                  </Pressable>
                ))
              )}

              {!loading && query.trim().length >= 2 && results.length === 0 ? (
                <Text style={styles.empty}>{he.locationNoResults}</Text>
              ) : null}
            </View>
          </>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  closeBtn: { padding: 2 },
  headerTitle: { ...typography.h3, color: colors.text, fontWeight: '800' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    margin: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: '#F5F5F5',
    borderRadius: radius.lg,
  },
  searchInput: {
    ...typography.body,
    flex: 1,
    color: colors.text,
    writingDirection: 'rtl',
    paddingVertical: spacing.xs,
  },
  results: { flex: 1, paddingHorizontal: spacing.lg },
  center: { paddingVertical: spacing.xl, alignItems: 'center' },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  resultText: { ...typography.body, color: colors.text, flex: 1, textAlign: RTL_LABEL_ALIGN },
  freeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  freeText: { ...typography.body, color: colors.primary, fontWeight: '700', flex: 1, textAlign: RTL_LABEL_ALIGN },
  empty: { ...typography.body, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl },
  confirmWrap: { flex: 1, padding: spacing.lg, gap: spacing.md },
  mapBox: {
    height: 300,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
  },
  confirmBody: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pickedLabel: { ...typography.body, color: colors.text, fontWeight: '700', flex: 1, textAlign: RTL_LABEL_ALIGN },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  secondaryBtn: { paddingVertical: spacing.sm, alignItems: 'center' },
  secondaryBtnText: { color: colors.primary, fontWeight: '700' },
});
