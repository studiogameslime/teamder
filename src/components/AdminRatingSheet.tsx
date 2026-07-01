// AdminRatingSheet — bottom-sheet editor for an admin-assigned player rating
// (0–5, or clear). Shared by the community players roster and the match roster
// so both edit the SAME internal rating through one UI. Save is wired by the
// caller (groupService.setAdminRating); this component only collects the value.

import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@/theme';
import { RatingSlider } from '@/components/RatingSlider';
import { he } from '@/i18n/he';
import type { User } from '@/types';

export function AdminRatingSheet({
  target,
  current,
  saving,
  onClose,
  onSave,
}: {
  /** Player being rated; the sheet is visible while this is non-null. */
  target: Pick<User, 'id' | 'name'> | null;
  current: number;
  saving: boolean;
  onClose: () => void;
  onSave: (rating: number | null) => void;
}) {
  const [value, setValue] = useState(current);
  // Sync the local stars to the opened player's stored rating.
  useEffect(() => {
    setValue(current);
  }, [current, target?.id]);
  return (
    <Modal
      visible={!!target}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={styles.sheetCard} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.sheetTitle}>
            {target ? he.communityAdminRatingTitle(target.name) : ''}
          </Text>
          <Text style={styles.sheetHint}>{he.communityAdminRatingHint}</Text>
          <RatingSlider value={value} onChange={setValue} />
          <View style={styles.sheetActions}>
            <Pressable
              onPress={() => onSave(null)}
              disabled={saving}
              style={({ pressed }) => [styles.sheetClear, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.sheetClearText}>{he.communityAdminRatingClear}</Text>
            </Pressable>
            <Pressable
              onPress={() => onSave(value === 0 ? null : value)}
              disabled={saving}
              style={({ pressed }) => [
                styles.sheetSave,
                saving && { opacity: 0.6 },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={styles.sheetSaveText}>{he.save}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheetCard: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.lg,
    gap: spacing.md,
    alignItems: 'center',
  },
  sheetTitle: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
    textAlign: 'center',
  },
  sheetHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
  sheetActions: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'stretch',
    marginTop: spacing.sm,
  },
  sheetSave: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  sheetSaveText: { ...typography.bodyBold, color: '#FFFFFF', fontWeight: '800' },
  sheetClear: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  sheetClearText: { ...typography.body, color: colors.danger, fontWeight: '700' },
});
