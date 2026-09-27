// "שיאי המועדון" — a scrolling shelf of records.
//
// This view knows NOTHING about what a record is. It renders whatever
// `buildClubRecords` hands it (`src/utils/clubRecords.ts`), which is the whole
// point: a new record is a new entry in that builder, and this file does not
// change. Icon, tint, label, value, unit and holder all arrive as data.
//
// A shelf rather than a grid, per the reference: the cards are narrow, centred
// and equal, and a fifth record extends the scroll instead of reflowing the
// rows above it.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ClubRecord } from '@/utils/clubRecords';
import { he } from '@/i18n/he';
import { formatDateShort } from '@/utils/format';
import { RTL_LABEL_ALIGN, clubCardTint, clubShadow, colors, spacing } from '@/theme';

export interface ClubRecordsProps {
  records: ClubRecord[];
  /** Opens the holder's profile. Omitted → those cards are inert. */
  onHolderPress?: (uid: string) => void;
  /**
   * Opens the EVENING a record was set in. Only records that belong to one
   * evening carry a `gameId`, so only those become tappable — the attendance
   * streak spans many and stays inert rather than leading somewhere arbitrary.
   */
  onEveningPress?: (gameId: string) => void;
}

export function ClubRecords({
  records,
  onHolderPress,
  onEveningPress,
}: ClubRecordsProps) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{he.clubRecordsTitle}</Text>
      {/* Said once, here, and never repeated on a card: the summary layer
          these records are read from began partway through the product's
          life, so they are the best of the measured period. */}
      <Text style={styles.since}>{he.clubRecordsSince}</Text>

      {records.length === 0 ? (
        <Text style={styles.empty}>{he.clubRecordsEmpty}</Text>
      ) : (
        // Built for ONE or TWO, because that is how many the club actually
        // has: the attendance record is a lifetime figure and is withheld
        // under a season scope, so a season shows one card and all-time shows
        // two. Capped at half the width and centred — a single record left to
        // stretch filled the row with one enormous card, and a shelf of narrow
        // ones looked like two more had failed to load. If the server ever
        // records the per-round maxima this becomes a wrapping grid and
        // nothing else here changes.
        <View style={styles.shelf}>
          {records.map((r) => {
            const evening = r.gameId && onEveningPress;
            const person = !r.gameId && r.holderUid && onHolderPress;
            const tappable = !!(evening || person);
            // The whole card is the press target, not just the footer line.
            const onPress = evening
              ? () => onEveningPress!(r.gameId!)
              : person
                ? () => onHolderPress!(r.holderUid!)
                : undefined;
            return (
              <Pressable
                key={r.key}
                style={({ pressed }) => [
                  styles.card,
                  { backgroundColor: clubCardTint(r.tint) },
                  pressed && tappable && styles.pressed,
                ]}
                disabled={!tappable}
                onPress={onPress}
                accessibilityRole={tappable ? 'button' : undefined}
                accessibilityLabel={`${r.label}: ${r.value}`}
                accessibilityHint={evening ? he.clubRecordOpenEvening : undefined}
              >
                {/* On the tint, the plate is white — the same inversion the
                    pair cards use, so a record reads as the same kind of
                    object as everything else on this screen. */}
                <View style={styles.iconPlate}>
                  <Ionicons name={r.icon as never} size={18} color={r.tint} />
                </View>
                <Text style={styles.label} numberOfLines={2}>
                  {r.label}
                </Text>
                <Text style={[styles.value, { color: r.tint }]} numberOfLines={1}>
                  {r.value}
                </Text>
                <Text style={styles.unit} numberOfLines={1}>
                  {r.hint ?? ''}
                </Text>
                {/* The navigation hint, and nothing louder. `chevron-back`
                    points the way a Hebrew reader goes forward — it is the
                    same glyph every pushing row on this screen uses, and RN
                    flips it under forceRTL. */}
                {evening ? (
                  <View style={styles.footer}>
                    <Ionicons name="chevron-back" size={13} color={colors.textMuted} />
                    <Text style={styles.footerText} numberOfLines={1}>
                      {r.at ? formatDateShort(r.at) : ''}
                    </Text>
                  </View>
                ) : r.holderName ? (
                  <View style={styles.footer}>
                    <Text style={styles.footerText} numberOfLines={1}>
                      {r.holderName}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  since: {
    fontSize: 12,
    color: '#7C869E',
    textAlign: RTL_LABEL_ALIGN,
    marginTop: -4,
  },
  // Two per row. Four records fill it exactly; one or three leave the last
  // card centred rather than stretched.
  shelf: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingTop: 2,
  },
  // Same contract for all four: one width, one height, one radius, one
  // padding. Nothing here is a hero — the difference between them is the
  // icon, the colour and the number.
  card: {
    flexGrow: 0,
    flexBasis: '48.5%',
    minWidth: 0,
    minHeight: 132,
    borderRadius: 16,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 3,
    ...clubShadow,
  },
  pressed: { opacity: 0.72 },
  iconPlate: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
    backgroundColor: '#FFFFFF',
  },
  label: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  value: {
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: -0.6,
    textAlign: RTL_LABEL_ALIGN,
    fontVariant: ['tabular-nums'],
  },
  unit: {
    fontSize: 12,
    color: '#7C869E',
    textAlign: RTL_LABEL_ALIGN,
  },
  // Chevron first → visual LEFT under forceRTL is wrong for a "forward" hint,
  // so the date leads on the right and the chevron closes the row.
  footer: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 3,
    marginTop: 4,
  },
  footerText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
  },
  empty: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
});
