// FriendActionButton — the friendship CTA on another player's card.
//
// Self-contained: it loads the viewer↔target relationship and renders the
// right action — send request / awaiting approval (tap to cancel) /
// accept incoming / already friends. Kept out of PlayerCardScreen so
// that screen stays focused on stats. No-op (renders null) for self or
// while loading.
//
// Outgoing → tappable to withdraw the request (with confirm dialog).
// Closes TU-04 — before, a sent request had no UI to cancel and the
// user was stuck.

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { appAlert } from '@/components/AppDialog';
import { Ionicons } from '@expo/vector-icons';
import { toast } from '@/components/Toast';
import {
  friendsService,
  type FriendRelationship,
} from '@/services/friendsService';
import { useGameStore } from '@/store/gameStore';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  meId: string;
  otherUserId: string;
}

export function FriendActionButton({ meId, otherUserId }: Props) {
  const [rel, setRel] = useState<FriendRelationship | null>(null);
  const [busy, setBusy] = useState(false);
  // Name is best-effort — comes from the gameStore players map (which
  // is hydrated for anyone who appeared in a game). Falls back to a
  // generic placeholder when we haven't seen them; the confirm dialog
  // still reads naturally.
  const otherName = useGameStore(
    (s) => s.players?.[otherUserId]?.displayName ?? he.friendsUnknownUser,
  );

  const load = useCallback(async () => {
    try {
      setRel(await friendsService.getRelationship(meId, otherUserId));
    } catch (e) {
      // A failed relationship lookup (e.g. a blocked friendRequests read)
      // must NOT make the button vanish — fall back to 'none' so the
      // user can still send a request.
      if (__DEV__) {
        console.warn('[FriendActionButton] getRelationship failed', e);
      }
      setRel('none');
    }
  }, [meId, otherUserId]);

  useEffect(() => {
    load();
  }, [load]);

  if (rel === null || rel === 'self') return null;

  // All three of these states drive a user-meaningful action when
  // tapped: send / cancel-mine / accept-theirs. 'friends' stays muted.
  const interactive = rel === 'none' || rel === 'incoming' || rel === 'outgoing';

  const doCancelOutgoing = async () => {
    setBusy(true);
    try {
      await friendsService.cancelRequest(meId, otherUserId);
      toast.success(he.friendsRequestCancelled);
      await load();
    } catch (e) {
      if (__DEV__) console.warn('[friendAction] cancel failed', e);
      appAlert(he.error, he.friendsActionFailed);
    } finally {
      setBusy(false);
    }
  };

  const onPress = async () => {
    if (!interactive || busy) return;
    // Outgoing — confirm before withdrawing. Sending a request is one
    // tap; pulling it back should be a deliberate decision so we don't
    // surface a "did the button do anything?" interaction.
    if (rel === 'outgoing') {
      appAlert(
        he.friendsCancelRequestConfirm,
        he.friendsCancelRequestConfirmBody(otherName),
        [
          { text: he.cancel, style: 'cancel' },
          {
            text: he.friendsCancelRequest,
            style: 'destructive',
            onPress: () => void doCancelOutgoing(),
          },
        ],
      );
      return;
    }
    setBusy(true);
    try {
      if (rel === 'none') {
        await friendsService.sendRequest(meId, otherUserId);
        toast.success(he.friendsRequestSent);
      } else if (rel === 'incoming') {
        await friendsService.acceptRequest(otherUserId, meId);
        toast.success(he.friendsAccepted);
      }
      await load();
    } catch (e) {
      if (__DEV__) console.warn('[friendAction] failed', e);
      appAlert(he.error, he.friendsActionFailed);
    } finally {
      setBusy(false);
    }
  };

  const config: Record<
    Exclude<FriendRelationship, 'self'>,
    { label: string; icon: keyof typeof Ionicons.glyphMap }
  > = {
    none: { label: he.friendsAdd, icon: 'person-add-outline' },
    // Outgoing now invites the cancel action — label hints at that.
    outgoing: { label: he.friendsPendingOutgoing, icon: 'time-outline' },
    incoming: { label: he.friendsRespondIncoming, icon: 'checkmark-circle-outline' },
    friends: { label: he.friendsAlready, icon: 'people' },
  };
  const { label, icon } = config[rel];

  return (
    <Pressable
      onPress={onPress}
      disabled={!interactive || busy}
      style={[
        styles.btn,
        // Outgoing gets a softer "pending" look — visually distinct from
        // the bold primary "send/accept" CTA — but still tappable.
        rel === 'outgoing'
          ? styles.pending
          : interactive
            ? styles.active
            : styles.muted,
        busy && { opacity: 0.6 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={
        rel === 'outgoing' ? he.friendsCancelRequest : label
      }
    >
      {busy ? (
        <ActivityIndicator
          size="small"
          color={
            rel === 'outgoing'
              ? colors.primary
              : interactive
                ? '#FFFFFF'
                : colors.textMuted
          }
        />
      ) : (
        <Ionicons
          name={icon}
          size={18}
          color={
            rel === 'outgoing'
              ? colors.primary
              : interactive
                ? '#FFFFFF'
                : colors.textMuted
          }
        />
      )}
      <Text
        style={[
          styles.label,
          rel === 'outgoing'
            ? styles.labelPending
            : interactive
              ? styles.labelActive
              : styles.labelMuted,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    marginTop: spacing.md,
    alignSelf: 'center',
  },
  active: { backgroundColor: colors.primary },
  muted: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  // Outgoing-pending — bordered, brand-tinted, distinct from both
  // primary CTA and disabled.
  pending: {
    backgroundColor: 'rgba(29,78,216,0.08)',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  label: { ...typography.body, fontWeight: '700' },
  labelActive: { color: '#FFFFFF' },
  labelMuted: { color: colors.textMuted },
  labelPending: { color: colors.primary },
});
