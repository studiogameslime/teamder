// RegistrationConflictModal — shown when the user tries to join a game
// while already registered for an overlapping one. Surfaces the clashing
// game and the two ways out: cancel the other registration, or go look
// at it. Lifted out of MatchDetailsScreen so the games LIST can show the
// same popup instead of a fly-by toast (which was easy to miss).

import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/Button';
import type { RegistrationConflict } from '@/services/gameService';
import type { Group } from '@/types';
import {
  colors,
  radius,
  spacing,
  typography,
  RTL_LABEL_ALIGN,
} from '@/theme';
import { he } from '@/i18n/he';
import { formatDateShort, formatTime } from '@/utils/format';

interface Props {
  conflict: RegistrationConflict | null;
  /** The game the user was trying to join — used for the cross-group
   *  title and the time-difference line. */
  targetGroupId?: string;
  targetStartsAt?: number;
  /** Communities the viewer belongs to, to resolve the conflicting
   *  game's group name. */
  communities: Pick<Group, 'id' | 'name'>[];
  cancelBusy?: boolean;
  /** Cancel the user's registration in the conflicting game. */
  onCancelOther: (conflictGameId: string) => void;
  /** Open the conflicting game's details. */
  onViewOther: (conflictGameId: string) => void;
  onClose: () => void;
}

export function RegistrationConflictModal({
  conflict,
  targetGroupId,
  targetStartsAt,
  communities,
  cancelBusy,
  onCancelOther,
  onViewOther,
  onClose,
}: Props) {
  return (
    <Modal
      visible={!!conflict}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <View style={styles.iconWrap}>
            <Ionicons
              name="alert-circle-outline"
              size={28}
              color={colors.warning}
            />
          </View>
          {conflict
            ? (() => {
                const group = communities.find((g) => g.id === conflict.groupId);
                const groupName =
                  group?.name ?? he.registrationConflictUnknownGroup;
                const isCrossGroup =
                  !!targetGroupId && conflict.groupId !== targetGroupId;
                const title = isCrossGroup
                  ? he.registrationConflictTitleOtherGroup
                  : he.registrationConflictTitle;
                const bothHaveTime =
                  typeof targetStartsAt === 'number' &&
                  targetStartsAt > 0 &&
                  conflict.startsAt > 0;
                const diffMinutes = bothHaveTime
                  ? Math.round(
                      Math.abs(conflict.startsAt - targetStartsAt!) / 60000,
                    )
                  : null;
                const diffText =
                  diffMinutes === null
                    ? null
                    : diffMinutes < 60
                      ? he.registrationConflictTimeDiffMinutes(diffMinutes)
                      : he.registrationConflictTimeDiffHoursMinutes(
                          Math.floor(diffMinutes / 60),
                          diffMinutes % 60,
                        );
                return (
                  <>
                    <Text style={styles.title}>{title}</Text>
                    <Text style={styles.body}>
                      {he.registrationConflictMessage}
                    </Text>
                    <View style={styles.gameRow}>
                      <Text style={styles.gameTitle} numberOfLines={2}>
                        {conflict.title}
                      </Text>
                      {conflict.startsAt > 0 ? (
                        <Text style={styles.gameWhen}>
                          {`${formatDateShort(conflict.startsAt)} · ${formatTime(
                            conflict.startsAt,
                          )}`}
                        </Text>
                      ) : null}
                      <Text style={styles.gameGroup}>{groupName}</Text>
                    </View>
                    {diffText ? (
                      <Text style={styles.diff}>{diffText}</Text>
                    ) : null}
                    <View style={styles.actions}>
                      <Button
                        title={he.registrationConflictCancelOther}
                        variant="primary"
                        size="lg"
                        fullWidth
                        loading={cancelBusy}
                        disabled={cancelBusy}
                        onPress={() => onCancelOther(conflict.gameId)}
                      />
                      <Button
                        title={he.registrationConflictViewOther}
                        variant="outline"
                        size="lg"
                        fullWidth
                        disabled={cancelBusy}
                        onPress={() => onViewOther(conflict.gameId)}
                      />
                      <Button
                        title={he.registrationConflictClose}
                        variant="outline"
                        size="sm"
                        fullWidth
                        disabled={cancelBusy}
                        onPress={onClose}
                      />
                    </View>
                  </>
                );
              })()
            : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.md,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  title: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  body: {
    ...typography.body,
    color: colors.textMuted,
    lineHeight: 22,
    textAlign: RTL_LABEL_ALIGN,
  },
  gameRow: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 4,
  },
  gameTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
  },
  gameWhen: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  gameGroup: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
    textAlign: RTL_LABEL_ALIGN,
  },
  diff: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    marginTop: -spacing.xs,
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
});
