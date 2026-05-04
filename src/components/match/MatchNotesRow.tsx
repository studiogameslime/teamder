// MatchNotesRow — a single compact row that hides the game's notes
// behind a tap. Replaces the old text-wall block at the top of the
// match details with one tappable line:
//
//   📋 חוקים והערות                              →
//
// Tap → modal-style bottom sheet with the full notes text. The row
// rendering is independent of whether notes exist; the parent passes
// the string and we render the empty-state inside the sheet, so the
// affordance stays consistent ("you can always check what's
// expected"). Pass `null` to skip rendering the row entirely.

import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  /** Notes text. Empty/whitespace renders the empty state in the
   *  sheet. Pass null to NOT render the row at all. */
  notes: string | null;
}

export function MatchNotesRow({ notes }: Props) {
  const [open, setOpen] = useState(false);
  if (notes === null) return null;
  const trimmed = notes.trim();
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.row,
          pressed && { backgroundColor: colors.surfaceMuted },
        ]}
        accessibilityRole="button"
        accessibilityLabel={he.matchNotesRowTitle}
      >
        <View style={styles.iconWrap}>
          <Ionicons
            name="reader-outline"
            size={18}
            color={colors.primary}
          />
        </View>
        <Text style={styles.label} numberOfLines={1}>
          {he.matchNotesRowTitle}
        </Text>
        <Ionicons name="chevron-back" size={18} color={colors.textMuted} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable
            style={styles.sheet}
            onPress={(e) => e.stopPropagation()}
          >
            <SafeAreaView edges={['bottom']} style={styles.safe}>
              <View style={styles.handle} />
              <View style={styles.headerRow}>
                <Text style={styles.title}>{he.matchNotesSheetTitle}</Text>
                <Pressable
                  onPress={() => setOpen(false)}
                  hitSlop={10}
                  style={({ pressed }) => [
                    styles.closeBtn,
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <Ionicons name="close" size={22} color={colors.text} />
                </Pressable>
              </View>
              <ScrollView contentContainerStyle={styles.content}>
                {trimmed.length === 0 ? (
                  <Text style={styles.empty}>{he.matchNotesEmpty}</Text>
                ) : (
                  <Text style={styles.body}>{trimmed}</Text>
                )}
              </ScrollView>
            </SafeAreaView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
    flex: 1,
  },
  // Bottom sheet
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    overflow: 'hidden',
  },
  safe: { paddingTop: spacing.xs },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  title: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  closeBtn: { padding: spacing.xs },
  content: {
    padding: spacing.lg,
    paddingTop: 0,
    gap: spacing.sm,
  },
  body: {
    ...typography.body,
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
    lineHeight: 22,
  },
  empty: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
});
