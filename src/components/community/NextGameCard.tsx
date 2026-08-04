// NextGameCard — the primary-focus dark-blue card on CommunityDetailsScreen.
// "Concept A" redesign: a hero header (eyebrow + live countdown chip), a big
// time, a location line, a 3-cell quick-stats strip (players / format / field),
// and a FULL-WIDTH "לפרטי המחזור" button with its icon on the visual-left.
//
// Layout under forceRTL: everything is right-aligned; the countdown chip sits on
// the visual-left of the header row, and the CTA icon is the LAST child so it
// lands on the visual-left of the label.
//
// Deferred (registration not open yet) → the CTA becomes a muted locked pill.
// No upcoming game → a quiet empty state (+ an admin "create recurring" CTA).

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { spacing, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { FieldType, GameFormat } from '@/types';
import { formatDayDate, formatGameDay, formatTime } from '@/utils/format';

interface Props {
  /** ms epoch — undefined when there is no upcoming game. */
  startsAt?: number;
  fieldName?: string;
  /** When set (and in the future), registration hasn't opened yet. */
  registrationOpensAt?: number;
  onPress?: () => void;
  onCreateRecurring?: () => void;
  // Quick-stats strip inputs (all optional — cells with no data are dropped).
  playersCount?: number;
  maxPlayers?: number;
  format?: GameFormat;
  fieldType?: FieldType;
}

function formatLabel(f: GameFormat | undefined): string | null {
  const s = f as string | undefined;
  if (s === '4v4') return he.gameFormat4;
  if (s === '5v5') return he.gameFormat5;
  if (s === '6v6') return he.gameFormat6;
  if (s === '7v7') return he.gameFormat7;
  if (typeof s === 'string' && /^\d+v\d+$/.test(s)) return s.replace('v', '×');
  return null;
}

function fieldTypeLabel(f: FieldType | undefined): string | null {
  if (f === 'asphalt') return he.fieldTypeAsphalt;
  if (f === 'synthetic') return he.fieldTypeSynthetic;
  if (f === 'grass') return he.fieldTypeGrass;
  return null;
}

/** Short relative countdown chip ("עוד 3 שעות" / "מחר" / …). null when the game
 *  has already started or is >7 days out (the date line already carries that). */
function countdownLabel(ms: number): string | null {
  const diff = ms - Date.now();
  if (diff <= 0) return null;
  const mins = Math.round(diff / 60000);
  if (mins < 60) return he.communityNextGameInMin(Math.max(1, mins));
  const hrs = Math.round(diff / 3_600_000);
  if (hrs < 24) return he.communityNextGameInHours(hrs);
  const days = Math.round(diff / 86_400_000);
  if (days === 1) return he.communityNextGameTomorrow;
  if (days <= 7) return he.communityNextGameInDays(days);
  return null;
}

export function NextGameCard({
  startsAt,
  fieldName,
  registrationOpensAt,
  onPress,
  onCreateRecurring,
  playersCount,
  maxPlayers,
  format,
  fieldType,
}: Props) {
  const hasGame = typeof startsAt === 'number';
  const isDeferred =
    typeof registrationOpensAt === 'number' &&
    registrationOpensAt > Date.now();
  const countdown = hasGame && !isDeferred ? countdownLabel(startsAt!) : null;

  // Quick-stats — only cells with real data survive.
  const stats: Array<{ n: string; t: string }> = [];
  if (typeof playersCount === 'number') {
    stats.push({
      n: maxPlayers ? `${playersCount}/${maxPlayers}` : String(playersCount),
      t: he.communityNextGameStatPlayers,
    });
  }
  const fmt = formatLabel(format);
  if (fmt) stats.push({ n: fmt, t: he.communityNextGameStatFormat });
  const field = fieldTypeLabel(fieldType);
  if (field) stats.push({ n: field, t: he.communityNextGameStatField });

  const inner = (
    <View style={styles.inner}>
      <View style={styles.headerRow}>
        <Text style={styles.eyebrow}>{he.communityNextGameEyebrow}</Text>
        {countdown ? (
          <View style={styles.chip}>
            <Ionicons name="time-outline" size={13} color="#FFFFFF" />
            <Text style={styles.chipText}>{countdown}</Text>
          </View>
        ) : null}
      </View>

      {hasGame ? (
        <>
          <Text style={styles.dateLine} numberOfLines={1}>
            {formatDayDate(startsAt!)}
          </Text>
          <Text style={styles.timeLine}>{formatTime(startsAt!)}</Text>
          {fieldName ? (
            <View style={styles.locationRow}>
              <Ionicons
                name="location"
                size={14}
                color="rgba(255,255,255,0.85)"
              />
              <Text style={styles.locationText} numberOfLines={1}>
                {fieldName}
              </Text>
            </View>
          ) : null}

          {stats.length > 0 ? (
            <View style={styles.stats}>
              {stats.map((s, i) => (
                <View
                  key={s.t}
                  style={[styles.stat, i > 0 && styles.statDivider]}
                >
                  <Text style={styles.statN} numberOfLines={1}>
                    {s.n}
                  </Text>
                  <Text style={styles.statT} numberOfLines={1}>
                    {s.t}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {isDeferred ? (
            <View style={[styles.cta, styles.ctaLocked]}>
              <Text style={styles.ctaLockedText} numberOfLines={1}>
                {he.communityNextGameLockedBody(formatLockTime(registrationOpensAt!))}
              </Text>
              <Ionicons
                name="lock-closed"
                size={17}
                color="rgba(255,255,255,0.9)"
              />
            </View>
          ) : onPress ? (
            <View style={styles.cta}>
              {/* Label first, icon LAST → icon on the visual-left under RTL. */}
              <Text style={styles.ctaText}>{he.communityNextGameFullCta}</Text>
              <Ionicons name="football" size={18} color="#1E3A8A" />
            </View>
          ) : null}
        </>
      ) : (
        <>
          <Text style={styles.emptyLine}>{he.communityNextGameNone}</Text>
          {onCreateRecurring ? (
            <Pressable
              onPress={onCreateRecurring}
              style={({ pressed }) => [
                styles.createCta,
                pressed && { opacity: 0.85 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={he.communityNextGameCreateRecurring}
            >
              <Text style={styles.createCtaText}>
                {he.communityNextGameCreateRecurring}
              </Text>
              <Ionicons name="repeat" size={18} color="#FFFFFF" />
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  );

  const gradient = (
    <LinearGradient
      colors={['#1E3A8A', '#1E40AF', '#0F172A']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
  );

  if (!hasGame || !onPress) {
    return (
      <View style={styles.card}>
        {gradient}
        {inner}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }]}
      accessibilityRole="button"
      accessibilityLabel={
        isDeferred
          ? he.communityNextGameLocked
          : he.communityNextGameDetailsCta
      }
    >
      {gradient}
      {inner}
    </Pressable>
  );
}

// "{day-long} HH:MM" — used inside the locked pill copy.
function formatLockTime(ms: number): string {
  return `${formatGameDay(ms)} ${formatTime(ms)}`;
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    borderRadius: 22,
    shadowColor: '#1E40AF',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.28,
    shadowRadius: 22,
    elevation: 8,
  },
  inner: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  eyebrow: {
    color: 'rgba(255,255,255,0.80)',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.4,
    textAlign: RTL_LABEL_ALIGN,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  dateLine: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 15,
    fontWeight: '600',
    textAlign: RTL_LABEL_ALIGN,
  },
  timeLine: {
    color: '#FFFFFF',
    fontSize: 40,
    fontWeight: '900',
    letterSpacing: 0.8,
    marginTop: 2,
    textAlign: RTL_LABEL_ALIGN,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 6,
  },
  locationText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13.5,
    fontWeight: '500',
    flexShrink: 1,
  },
  stats: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 14,
    overflow: 'hidden',
    marginTop: 14,
  },
  stat: { flex: 1, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center' },
  statDivider: {
    borderStartWidth: 1,
    borderStartColor: 'rgba(255,255,255,0.12)',
  },
  statN: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  statT: { color: 'rgba(255,255,255,0.72)', fontSize: 11, marginTop: 2 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 13,
    marginTop: 14,
  },
  ctaText: { color: '#1E3A8A', fontSize: 15, fontWeight: '800' },
  ctaLocked: { backgroundColor: 'rgba(0,0,0,0.28)' },
  ctaLockedText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13.5,
    fontWeight: '700',
  },
  emptyLine: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    fontWeight: '500',
    fontStyle: 'italic',
    textAlign: RTL_LABEL_ALIGN,
    marginTop: 6,
  },
  createCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 14,
  },
  createCtaText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
