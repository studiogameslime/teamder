import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors, font, radius } from '../theme';
import { useDashboard } from '../state/DashboardContext';
import { Empty, Screen, SectionHeader } from '../components/ui';
import { ReviewItem } from '../components/ReviewItem';
import { RatingHistogram } from '../components/RatingHistogram';
import type { StoreSource } from '../types';

type Filter = 'all' | StoreSource | 'low';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'הכל' },
  { key: 'appstore', label: 'App Store' },
  { key: 'googleplay', label: 'Google Play' },
  { key: 'low', label: '★ נמוכות (≤3)' },
];

export function ReviewsScreen() {
  const { snapshot, refreshing, refresh } = useDashboard();
  const nav = useNavigation<any>();
  const [filter, setFilter] = useState<Filter>('all');

  const reviews = useMemo(() => {
    const all = snapshot.reviews;
    if (filter === 'all') return all;
    if (filter === 'low') return all.filter((r) => r.rating <= 3);
    return all.filter((r) => r.source === filter);
  }, [snapshot.reviews, filter]);

  return (
    <Screen
      title="ביקורות"
      subtitle={`${reviews.length} מתוך ${snapshot.reviews.length}`}
      onBack={() => (nav.canGoBack() ? nav.goBack() : nav.navigate('Overview'))}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={refresh}
          tintColor={colors.primary}
        />
      }
    >
      {snapshot.ratings.length ? (
        <>
          <SectionHeader>דירוגים</SectionHeader>
          {snapshot.ratings.map((r) => (
            <RatingHistogram key={r.source} r={r} />
          ))}
          <SectionHeader>ביקורות</SectionHeader>
        </>
      ) : null}

      <View style={styles.chips}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {reviews.length ? (
        reviews.map((r) => <ReviewItem key={r.id} review={r} />)
      ) : (
        <Empty text="אין ביקורות בקטגוריה זו" />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...font.small, color: colors.textSoft },
  chipTextActive: { color: '#fff', fontWeight: '700' },
});
