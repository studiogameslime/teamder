// FriendActionButton — the friendship CTA on another player's card.
//
// Self-contained: it loads the viewer↔target relationship and renders the
// right action — send request / awaiting approval / accept incoming /
// already friends. Kept out of PlayerCardScreen so that screen stays
// focused on stats. No-op (renders null) for self or while loading.

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { toast } from '@/components/Toast';
import {
  friendsService,
  type FriendRelationship,
} from '@/services/friendsService';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  meId: string;
  otherUserId: string;
}

export function FriendActionButton({ meId, otherUserId }: Props) {
  const [rel, setRel] = useState<FriendRelationship | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setRel(await friendsService.getRelationship(meId, otherUserId));
  }, [meId, otherUserId]);

  useEffect(() => {
    load();
  }, [load]);

  if (rel === null || rel === 'self') return null;

  const interactive = rel === 'none' || rel === 'incoming';

  const onPress = async () => {
    if (!interactive || busy) return;
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
      Alert.alert(he.error, String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const config: Record<
    Exclude<FriendRelationship, 'self'>,
    { label: string; icon: keyof typeof Ionicons.glyphMap }
  > = {
    none: { label: he.friendsAdd, icon: 'person-add-outline' },
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
        interactive ? styles.active : styles.muted,
        busy && { opacity: 0.6 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {busy ? (
        <ActivityIndicator size="small" color={interactive ? '#FFFFFF' : colors.textMuted} />
      ) : (
        <Ionicons
          name={icon}
          size={18}
          color={interactive ? '#FFFFFF' : colors.textMuted}
        />
      )}
      <Text style={[styles.label, interactive ? styles.labelActive : styles.labelMuted]}>
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
  label: { ...typography.body, fontWeight: '700' },
  labelActive: { color: '#FFFFFF' },
  labelMuted: { color: colors.textMuted },
});
