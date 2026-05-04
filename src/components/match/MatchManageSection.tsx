// MatchManageSection — collapsible "ניהול משחק" block at the bottom
// of the redesigned MatchDetailsScreen. Holds the rare admin
// affordances (visibility toggle + delete) that don't deserve a
// permanent slot above the fold.
//
// Defaults to COLLAPSED — admins who don't need to manage the game
// just see a single 32 dp row that doesn't fight for attention.
//
// The component is a controlled view: the screen owns the busy /
// visibility state and passes handlers in. Keeps the component
// reusable and lets the parent show progress indicators where it
// already does (sticky CTA loader, etc.).

import React, { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  /** Render the visibility row only when the game is still 'open'.
   *  Caller decides; we just paint. */
  showVisibility: boolean;
  visibilityIsPublic: boolean;
  onToggleVisibility: (next: boolean) => void;
  onDelete: () => void;
  busy?: boolean;
}

export function MatchManageSection({
  showVisibility,
  visibilityIsPublic,
  onToggleVisibility,
  onDelete,
  busy,
}: Props) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => [
          styles.toggleRow,
          pressed && { backgroundColor: colors.surfaceMuted },
        ]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Ionicons
          name="settings-outline"
          size={18}
          color={colors.textMuted}
        />
        <Text style={styles.toggleLabel}>{he.matchManageToggle}</Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.textMuted}
        />
      </Pressable>
      {open ? (
        <View style={styles.body}>
          {showVisibility ? (
            <Pressable
              onPress={() => onToggleVisibility(!visibilityIsPublic)}
              disabled={busy}
              style={({ pressed }) => [
                styles.row,
                pressed && { opacity: 0.85 },
              ]}
              accessibilityRole="switch"
              accessibilityState={{ checked: visibilityIsPublic }}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{he.matchVisibilityToggle}</Text>
                <Text style={styles.rowHelper}>{he.matchVisibilityHelper}</Text>
              </View>
              <Switch
                value={visibilityIsPublic}
                disabled={busy}
                onValueChange={onToggleVisibility}
                trackColor={{
                  false: colors.surfaceMuted,
                  true: colors.primary,
                }}
              />
            </Pressable>
          ) : null}
          <Pressable
            onPress={onDelete}
            style={({ pressed }) => [
              styles.deleteRow,
              pressed && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={he.deleteGameAction}
          >
            <Ionicons name="trash-outline" size={18} color={colors.danger} />
            <Text style={styles.deleteText}>{he.deleteGameAction}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
  },
  toggleLabel: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
    flex: 1,
  },
  body: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  rowTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    textAlign: RTL_LABEL_ALIGN,
  },
  rowHelper: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  deleteText: {
    ...typography.body,
    color: colors.danger,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
  },
});
