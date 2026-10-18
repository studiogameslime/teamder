// GameChatScreen — resolves the game (title + moderator) and renders the
// shared ChatView in game scope. Reached from the chats list AND from the
// match-details screen.

import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, View, StyleSheet } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';

import { Button } from '@/components/Button';
import { RoundChatBanner } from '@/components/chat/RoundChatBanner';
import { ChatView } from '@/components/chat/ChatView';
import { ScreenHeader } from '@/components/ScreenHeader';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { chatService } from '@/services/chatService';
import { roundChatState } from '@/utils/chatInbox';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import { colors, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import type { Game } from '@/types';
import type { ChatStackParamList } from '@/navigation/ChatStack';

export function GameChatScreen() {
  const route = useRoute<RouteProp<ChatStackParamList, 'GameChat'>>();
  const { gameId } = route.params;
  const me = useUserStore((s) => s.currentUser);
  const groups = useGroupStore((s) => s.groups);
  const qaState = __DEV__ && process.env.EXPO_PUBLIC_QA_ROUTES === '1' && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1'
    ? (route.params as {qaChatState?:string}).qaChatState : undefined;
  const previewMessages = useMemo(() => qaState ? (require('@/dev/chatInboxFixture') as typeof import('@/dev/chatInboxFixture')).chatPreviewMessages(me?.id ?? '') : undefined,[qaState,me?.id]);
  const [game, setGame] = useState<Game | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setNow(Date.now());
    if(!game || game.status!=='finished') return;
    const remaining=roundChatState(game,Date.now()).remainingMs ?? 0;
    if(remaining<=0) return;
    const timer=setTimeout(()=>setNow(Date.now()),Math.min(remaining,2147483647));
    return ()=>clearTimeout(timer);
  },[game]);
  useEffect(() => {
    setLoading(true); setFailed(false); setGame(null);
    return chatService.subscribeGameParent(gameId, g => { setGame(g && qaState ? {...g,players:[...g.players,me?.id ?? ''],status:'finished',endedAt:Date.now()-(qaState==='_chat_closed'?25:16)*3600000} : g); setLoading(false); }, err => {
      const code = String((err as {code?:string})?.code ?? '');
      logEvent(AnalyticsEvent.ChatLoadFailed, {scope:'game',reason:code.includes('permission-denied')?'game_unavailable':'fetch_failed'});
      setFailed(!code.includes('permission-denied')); setGame(null); setLoading(false);
    });
  }, [gameId, reloadTick, qaState, me?.id]);

  if (loading) {
    // Keep a header (with back button) while the game resolves, so the user
    // is never stranded on a bare spinner with no way back.
    return (
      <View style={styles.flex}>
        <ScreenHeader title={he.chatLoadingTitle} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  if (failed) return (
    <View style={styles.flex}>
      <ScreenHeader title={he.chatOpenGame} />
      <View style={styles.center}>
        <Text style={styles.emptyText}>{he.dmLoadError}</Text>
        <Button title={he.retry} variant="outline" onPress={() => setReloadTick((t) => t + 1)} />
      </View>
    </View>
  );

  // Moderator = the organiser OR an admin of the game's community.
  const grp = game ? groups.find((g) => g.id === game.groupId) : undefined;
  const canModerate =
    !!me &&
    !!game &&
    (me.id === game.createdBy || (grp?.adminIds.includes(me.id) ?? false));

  // Chat members = the registered roster. Organiser + community admins
  // are flagged as admins in the members sheet.
  const memberIds = game?.players ?? [];
  const adminIds = [
    ...(game?.createdBy ? [game.createdBy] : []),
    ...(grp?.adminIds ?? []),
  ];

  // Game couldn't be resolved (deleted, or no read access) — show a friendly
  // fallback with a way back instead of an empty-titled chat that can't load.
  if (!game || !me || (!game.players.includes(me.id) && !canModerate)) {
    return (
      <View style={styles.flex}>
        <ScreenHeader title={he.chatOpenGame} />
        <View style={styles.center}>
          <Text style={styles.emptyText}>{he.chatGameUnavailable}</Text>
        </View>
      </View>
    );
  }

  const state = roundChatState(game, now);

  return (
    <ChatView
      scope="game"
      parentId={gameId}
      title={game?.title ?? ''}
      canModerate={canModerate}
      memberIds={Array.from(new Set([...memberIds,...adminIds]))}
      readOnly={state.closed}
      statusBanner={<RoundChatBanner game={game}/>}
      previewMessages={previewMessages}
      adminIds={adminIds}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: spacing.xl },
  emptyText: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
});
