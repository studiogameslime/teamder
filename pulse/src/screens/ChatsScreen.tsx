// ChatsScreen — one home for all chat monitoring across Teamder:
//   • הודעות  — every chat message (sender + where + text)
//   • דיווחים — reported messages (cycle status / delete)
//   • חסימות  — who blocked whom
// A segmented control swaps between the three; each loads lazily on first
// view and on pull-to-refresh.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, radius } from '../theme';
import { Card, Empty, Screen } from '../components/ui';
import {
  listRecentChatMessages,
  listChatReports,
  listRecentBlocks,
  setChatReportStatus,
  deleteChatReport,
  type ChatMsg,
  type ChatReport,
  type ChatBlock,
  type ChatReportStatus,
} from '../services/chatMonitorService';

type Seg = 'messages' | 'reports' | 'blocks';
const SEGS: { key: Seg; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'messages', label: 'הודעות', icon: 'chatbubbles' },
  { key: 'reports', label: 'דיווחים', icon: 'flag' },
  { key: 'blocks', label: 'חסימות', icon: 'ban' },
];

const STATUS_META: Record<ChatReportStatus, { label: string; color: string }> = {
  new: { label: 'חדש', color: colors.red },
  reviewed: { label: 'נבדק', color: colors.amber },
  done: { label: 'טופל', color: colors.green },
};
const STATUS_ORDER: ChatReportStatus[] = ['new', 'reviewed', 'done'];

const scopeHe = (s: string) =>
  s === 'community' ? 'מועדון' : s === 'game' ? 'משחק' : s;

function timeHe(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} · ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function ChatsScreen() {
  const [seg, setSeg] = useState<Seg>('messages');
  const [messages, setMessages] = useState<ChatMsg[] | null>(null);
  const [reports, setReports] = useState<ChatReport[] | null>(null);
  const [blocks, setBlocks] = useState<ChatBlock[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadSeg = useCallback(async (which: Seg) => {
    if (which === 'messages') {
      setMessages(await listRecentChatMessages(80).catch(() => []));
    } else if (which === 'reports') {
      setReports(await listChatReports().catch(() => []));
    } else {
      setBlocks(await listRecentBlocks(80).catch(() => []));
    }
  }, []);

  // Lazy-load each segment the first time it's shown.
  useEffect(() => {
    if (seg === 'messages' && messages === null) void loadSeg('messages');
    if (seg === 'reports' && reports === null) void loadSeg('reports');
    if (seg === 'blocks' && blocks === null) void loadSeg('blocks');
  }, [seg, messages, reports, blocks, loadSeg]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadSeg(seg);
    setRefreshing(false);
  };

  const cycleStatus = async (it: ChatReport) => {
    const next =
      STATUS_ORDER[(STATUS_ORDER.indexOf(it.status) + 1) % STATUS_ORDER.length];
    setReports((rs) => rs?.map((r) => (r.id === it.id ? { ...r, status: next } : r)) ?? rs);
    await setChatReportStatus(it.id, next).catch(() => {});
  };
  const removeReport = async (it: ChatReport) => {
    setReports((rs) => rs?.filter((r) => r.id !== it.id) ?? rs);
    await deleteChatReport(it.id).catch(() => {});
  };

  const active = seg === 'messages' ? messages : seg === 'reports' ? reports : blocks;

  return (
    <Screen
      title="צ'אטים"
      subtitle="הודעות, דיווחים וחסימות — כל מה שקורה בצ׳אטים של Teamder"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
    >
      {/* Segmented control */}
      <View style={s.segRow}>
        {SEGS.map((sg) => {
          const on = seg === sg.key;
          return (
            <Pressable
              key={sg.key}
              onPress={() => setSeg(sg.key)}
              style={[s.seg, on && s.segOn]}
            >
              <Ionicons name={sg.icon} size={15} color={on ? '#fff' : colors.textSoft} />
              <Text style={[s.segTxt, on && s.segTxtOn]}>{sg.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {active === null ? (
        <View style={{ paddingVertical: 40 }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : seg === 'messages' ? (
        messages && messages.length > 0 ? (
          messages.map((m) => (
            <Card key={`${m.parentId}:${m.id}`} style={s.item}>
              <View style={s.head}>
                <Ionicons
                  name={m.scope === 'community' ? 'shield' : 'football'}
                  size={14}
                  color={colors.primary}
                />
                <Text style={s.sender} numberOfLines={1}>{m.senderName || 'משתמש'}</Text>
                <View style={{ flex: 1 }} />
                <Text style={s.scope}>{scopeHe(m.scope)}</Text>
              </View>
              {m.text ? <Text style={s.message}>{m.text}</Text> : null}
              <Text style={s.meta}>{timeHe(m.createdAt)}</Text>
            </Card>
          ))
        ) : (
          <Empty text="אין הודעות להצגה" />
        )
      ) : seg === 'reports' ? (
        reports && reports.length > 0 ? (
          reports.map((it) => {
            const sm = STATUS_META[it.status];
            return (
              <Card key={it.id} style={s.item}>
                <View style={s.head}>
                  <View style={s.kindTag}>
                    <Ionicons name="flag" size={12} color={colors.red} />
                    <Text style={[s.kindTxt, { color: colors.red }]}>{scopeHe(it.scope)}</Text>
                  </View>
                  <View style={{ flex: 1 }} />
                  <Pressable onPress={() => cycleStatus(it)} style={[s.statusPill, { borderColor: sm.color }]}>
                    <View style={[s.statusDot, { backgroundColor: sm.color }]} />
                    <Text style={[s.statusTxt, { color: sm.color }]}>{sm.label}</Text>
                  </Pressable>
                  <Pressable onPress={() => removeReport(it)} hitSlop={8} style={{ padding: 4 }}>
                    <Ionicons name="trash-outline" size={16} color={colors.textMuted} />
                  </Pressable>
                </View>
                {it.messageText ? (
                  <Text style={s.message}>“{it.messageText}”</Text>
                ) : (
                  <Text style={[s.message, { color: colors.textMuted }]}>(ההודעה ללא טקסט)</Text>
                )}
                <Text style={s.meta}>
                  {it.senderName || 'משתמש'} · דווח ע״י {it.reporterId.slice(0, 6)} · {timeHe(it.createdAt)}
                </Text>
              </Card>
            );
          })
        ) : (
          <Empty text="אין דיווחים" />
        )
      ) : blocks && blocks.length > 0 ? (
        blocks.map((b) => (
          <Card key={b.id} style={s.item}>
            <View style={s.head}>
              <Ionicons name="ban" size={14} color={colors.red} />
              <Text style={s.sender} numberOfLines={1}>{b.blockerName}</Text>
              <Text style={s.blockArrow}> חסם את </Text>
              <Text style={[s.sender, { color: colors.red }]} numberOfLines={1}>{b.blockedName}</Text>
            </View>
            <Text style={s.meta}>{timeHe(b.at)}</Text>
          </Card>
        ))
      ) : (
        <Empty text="אין חסימות" />
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  segRow: { flexDirection: 'row-reverse', gap: 8, marginBottom: 12 },
  seg: {
    flex: 1,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  segOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  segTxt: { ...font.small, color: colors.textSoft, fontWeight: '800' },
  segTxtOn: { color: '#fff' },
  item: { gap: 6, marginBottom: 8 },
  head: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  sender: { ...font.body, color: colors.text, fontWeight: '800', textAlign: 'right', maxWidth: '40%' },
  blockArrow: { ...font.small, color: colors.textSoft, fontWeight: '700' },
  scope: { ...font.small, color: colors.textSoft, fontWeight: '700' },
  message: { ...font.body, color: colors.text, textAlign: 'right', lineHeight: 21 },
  meta: { ...font.small, color: colors.textMuted, textAlign: 'right' },
  kindTag: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4 },
  kindTxt: { ...font.small, fontWeight: '800' },
  statusPill: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusTxt: { ...font.small, fontWeight: '800' },
});
