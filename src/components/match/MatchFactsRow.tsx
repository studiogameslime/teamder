// MatchFactsRow — small icon-led chips that surface the match's
// rules at a glance. Sits right under the hero strip on
// MatchDetailsScreen. Designed to add visual texture WITHOUT a
// text wall: each chip is just an icon + 1–2 short tokens.
//
// Chips render only when the underlying field is set, so a minimal
// game shows 2 chips and a full-rules game shows up to 6 — never
// dominates the screen.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { FieldType, GameFormat } from '@/types';
import { colors, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  format?: GameFormat;
  fieldType?: FieldType;
  matchDurationMinutes?: number;
  hasReferee?: boolean;
  hasPenalties?: boolean;
  hasHalfTime?: boolean;
}

export function MatchFactsRow(props: Props) {
  const chips: Array<{
    key: string;
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
  }> = [];

  if (props.format) {
    chips.push({
      key: 'format',
      icon: 'football-outline',
      label: formatLabel(props.format),
    });
  }
  if (props.fieldType) {
    chips.push({
      key: 'field',
      icon: 'leaf-outline',
      label: fieldTypeLabel(props.fieldType),
    });
  }
  if (
    typeof props.matchDurationMinutes === 'number' &&
    props.matchDurationMinutes > 0
  ) {
    chips.push({
      key: 'duration',
      icon: 'time-outline',
      label: `${props.matchDurationMinutes}'`,
    });
  }
  if (props.hasReferee) {
    chips.push({
      key: 'ref',
      icon: 'flag-outline',
      label: he.wizardHasReferee,
    });
  }
  if (props.hasHalfTime) {
    chips.push({
      key: 'halves',
      icon: 'pause-circle-outline',
      label: he.wizardHasHalfTime,
    });
  }
  if (props.hasPenalties) {
    chips.push({
      key: 'pks',
      icon: 'radio-button-on-outline',
      label: he.wizardHasPenalties,
    });
  }

  if (chips.length === 0) return null;
  return (
    <View style={styles.row}>
      {chips.map((c) => (
        <View key={c.key} style={styles.chip}>
          <Ionicons name={c.icon} size={12} color={colors.textMuted} />
          <Text style={styles.chipText}>{c.label}</Text>
        </View>
      ))}
    </View>
  );
}

function formatLabel(f: GameFormat): string {
  if (f === '5v5') return he.gameFormat5;
  if (f === '6v6') return he.gameFormat6;
  return he.gameFormat7;
}

function fieldTypeLabel(f: FieldType): string {
  if (f === 'asphalt') return he.fieldTypeAsphalt;
  if (f === 'synthetic') return he.fieldTypeSynthetic;
  return he.fieldTypeGrass;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.surface,
    // Subtle outline rather than a heavy shadow — chips need to feel
    // weightless next to the hero card above.
    borderWidth: 1,
    borderColor: colors.divider,
  },
  chipText: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '600',
    fontSize: 12,
  },
});
