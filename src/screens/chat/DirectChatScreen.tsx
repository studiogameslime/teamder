// DirectChatScreen — a 1-on-1 direct-message chat. Resolves the other person
// (the participant that isn't me), ensures the conversation doc exists, and
// renders the shared ChatView in 'dm' scope with the other person's name as
// the title. Reached from the chats list AND the "שלח הודעה" button on a
// player card.

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, type RouteProp } from '@react-navigation/native';

import { ChatView } from '@/components/chat/ChatView';
import { chatService } from '@/services/chatService';
import { userService } from '@/services/userService';
import { useUserStore } from '@/store/userStore';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/Button';
import { colors, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import type { User } from '@/types';
import type { ChatStackParamList } from '@/navigation/ChatStack';

export function DirectChatScreen() {
  const route = useRoute<RouteProp<ChatStackParamList, 'DirectChat'>>();
  const { convId } = route.params;
  const me = useUserStore((s) => s.currentUser);
  const otherId = me ? convId.split('__').find((u) => u !== me.id) ?? '' : '';

  const [other, setOther] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // True when the conversation can't be opened — the other user limited DMs to
  // friends and we're not friends (rules reject the conversation create).
  const [restricted, setRestricted] = useState(false);
  // Transient (offline / non-permission) failure — distinct from `restricted`,
  // so an offline user isn't wrongly told "friends-only". Offers a retry.
  const [failed, setFailed] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!me || !otherId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setRestricted(false);
      setFailed(false);
      try {
        const u = await userService.getUserById(otherId);
        if (!alive) return;
        setOther(u);
        await chatService.ensureDmConversation(me.id, otherId);
        await chatService.touchMyDmEntry(me.id, convId, {
          name: u?.name ?? '',
          avatarId: u?.avatarId,
          photoUrl: u?.photoUrl,
        });
        await chatService.markChatRead(me.id, 'dm', convId);
      } catch (e) {
        if (!alive) return;
        // Only a rules rejection (friends-only) is a real restriction; every
        // other error (offline / transient) gets a retryable error state.
        const code = String((e as { code?: string })?.code ?? '');
        if (code.includes('permission-denied')) setRestricted(true);
        else setFailed(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [me?.id, otherId, convId, reloadTick]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (restricted || !me || !otherId) {
    return (
      <View style={styles.root}>
        <ScreenHeader title={other?.name ?? he.dmTitle} />
        <View style={styles.center}>
          <Ionicons name="lock-closed-outline" size={42} color={colors.textMuted} />
          <Text style={styles.restrictedText}>{he.dmRestricted}</Text>
        </View>
      </View>
    );
  }

  if (failed) {
    return (
      <View style={styles.root}>
        <ScreenHeader title={other?.name ?? he.dmTitle} />
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={42} color={colors.textMuted} />
          <Text style={styles.restrictedText}>{he.dmLoadError}</Text>
          <Button
            title={he.gameRetry}
            variant="outline"
            onPress={() => setReloadTick((t) => t + 1)}
          />
        </View>
      </View>
    );
  }

  return (
    <ChatView
      scope="dm"
      parentId={convId}
      title={other?.name ?? ''}
      canModerate={false}
      memberIds={[me.id, otherId]}
      adminIds={[]}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    gap: spacing.md,
    padding: spacing.xl,
  },
  restrictedText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
