import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TeamderChatSheet } from '../components/TeamderChatSheet';
import { colors, font, radius } from '../theme';
import { Card, SectionHeader } from '../components/ui';
import { useDashboard } from '../state/DashboardContext';
import { fetchUserActivity, setUserQa } from '../services/firebase';
import { getDoc } from '../services/firestoreRest';
import { timeAgo } from '../format';
import type { TimelineEvent, UserActivity } from '../types';
import type { UsersStackParams } from '../navigation/UsersStack';

// Bug-status pill on the user card — resolved/in-review bugs stay visible
// (instead of vanishing) with a clear label.
const BUG_STATUS: Record<'new' | 'reviewed' | 'resolved', { label: string; color: string }> = {
  new: { label: 'פתוח', color: colors.red },
  reviewed: { label: 'בבדיקה', color: colors.amber },
  resolved: { label: 'תוקן ✓', color: colors.green },
};

const KIND_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  joined: 'person-add',
  game: 'football',
  community: 'people',
  achievement: 'trophy',
  card: 'albums',
  invited: 'share-social',
  feedback: 'chatbox-ellipses',
};

function toneColor(t?: string) {
  return t === 'green'
    ? colors.green
    : t === 'amber'
      ? colors.amber
      : t === 'red'
        ? colors.red
        : colors.primary;
}

function TimelineRow({ e, last }: { e: TimelineEvent; last: boolean }) {
  const c = toneColor(e.tone);
  return (
    <View style={styles.tlRow}>
      <View style={styles.tlGutter}>
        <View style={[styles.tlDot, { backgroundColor: c }]}>
          <Ionicons name={KIND_ICON[e.kind] ?? 'ellipse'} size={13} color="#fff" />
        </View>
        {!last ? <View style={styles.tlLine} /> : null}
      </View>
      <View style={styles.tlBody}>
        {e.action ? (
          <Text style={[styles.tlAction, { color: c }]}>{e.action}</Text>
        ) : null}
        <Text style={styles.tlTitle}>{e.title}</Text>
        {e.subtitle ? <Text style={styles.tlSub}>{e.subtitle}</Text> : null}
        <Text style={styles.tlTime}>{timeAgo(e.at)}</Text>
      </View>
    </View>
  );
}

export function UserDetailScreen() {
  const route = useRoute<RouteProp<UsersStackParams, 'UserDetail'>>();
  const nav = useNavigation();
  const { snapshot } = useDashboard();
  const { userId } = route.params;
  const [data, setData] = useState<UserActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [qa, setQa] = useState(false);
  const [qaSaving, setQaSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [messaging, setMessaging] = useState(false);

  // The user's personal invite link — registrations + clicks through it are
  // attributed to them (matches deepLinkService.buildAppInviteUrl on the app).
  const inviteLink = `https://teamderfc.web.app/app?invitedBy=${userId}`;
  const copyInviteLink = async () => {
    await Clipboard.setStringAsync(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const a = await fetchUserActivity(userId);
        if (alive) setData(a);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  const u = data?.user ?? snapshot.users.find((x) => x.id === userId);

  // Seed the QA toggle from the (possibly stale) cached user...
  useEffect(() => {
    if (u) setQa(u.qa === true);
  }, [u?.id, u?.qa]);

  // ...then override with the LIVE value straight from Firestore. The cached
  // users snapshot has a TTL and won't reflect a qa change made outside Pulse
  // (e.g. an earlier session), which made the toggle show the wrong state.
  useEffect(() => {
    let alive = true;
    getDoc(`users/${userId}`)
      .then((d) => {
        if (alive && d) setQa(d.qa === true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId]);

  // Always return to the users LIST, never to whatever tab happens to be
  // "first" in the tab navigator's back-behavior. goBack() from a hidden
  // tab's stack can fall through to Home; navigating to the named route
  // pops straight to the list (and works even if the detail was the only
  // screen restored on the stack).
  const goBackToList = () => {
    (nav as any).navigate('UsersList');
  };

  const toggleQa = async () => {
    if (!u || qaSaving) return;
    const next = !qa;
    setQa(next); // optimistic
    setQaSaving(true);
    const ok = await setUserQa(u.id, next);
    if (!ok) setQa(!next); // revert on failure
    setQaSaving(false);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={goBackToList} style={styles.back} hitSlop={10}>
          <Ionicons name="chevron-forward" size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {u?.name ?? 'משתמש'}
        </Text>
        {/* Talk to this person as Teamder — the same sheet the tasks screen
            uses, so a conversation started here shows the same thread. */}
        <Pressable onPress={() => setMessaging(true)} hitSlop={10}>
          <Ionicons name="chatbubble-ellipses-outline" size={22} color={colors.primary} />
        </Pressable>
      </View>

      <TeamderChatSheet
        visible={messaging}
        userId={userId}
        userName={u?.name ?? ''}
        onClose={() => setMessaging(false)}
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {u ? (
          <Card style={styles.profile}>
            <Text style={styles.pName}>{u.name}</Text>
            <Text style={styles.pSub}>
              {[u.city, u.email].filter(Boolean).join(' · ') || '—'}
            </Text>
            <View style={styles.pStats}>
              <Stat label="משחקים" value={`${u.attended}/${u.totalGames}`} />
              <Stat label="הישגים" value={String(u.achievements)} />
              <Stat label="חברים" value={String(u.friends)} />
              <Stat label="כרטיסים" value={`${u.yellowCards}🟨 ${u.redCards}🟥`} />
            </View>
            {/* Personal-invite-link performance: how many tapped the link vs
                how many actually registered through it (conversion). */}
            {data ? (
              <View style={styles.inviteBox}>
                <View style={styles.inviteCell}>
                  <Text style={styles.inviteNum}>{data.referralCount}</Text>
                  <Text style={styles.inviteLbl}>נרשמו דרכו</Text>
                </View>
                <View style={styles.inviteDiv} />
                <View style={styles.inviteCell}>
                  <Text style={styles.inviteNum}>{data.inviteClicks}</Text>
                  <Text style={styles.inviteLbl}>קליקים על הקישור</Text>
                </View>
              </View>
            ) : null}
            <Pressable
              onPress={copyInviteLink}
              style={[styles.copyBtn, copied && styles.copyBtnOn]}
            >
              <Ionicons
                name={copied ? 'checkmark' : 'copy-outline'}
                size={16}
                color={copied ? '#fff' : colors.primary}
              />
              <Text style={[styles.copyTxt, copied && { color: '#fff' }]}>
                {copied ? 'הועתק ✓' : 'העתק לינק הזמנה אישי'}
              </Text>
            </Pressable>
            {data?.invitedByName ? (
              <Text style={styles.pRef}>📩 הוזמן ע״י {data.invitedByName}</Text>
            ) : u.acquisition?.source ? (
              <Text style={styles.pRef}>🔗 נרשם דרך קישור: {u.acquisition.source}{u.acquisition.campaign ? ` · ${u.acquisition.campaign}` : ''}</Text>
            ) : (
              <Text style={styles.pRef}>🌱 נרשם ישירות (אורגני)</Text>
            )}
            {data && data.referredNames.length ? (
              <Text style={styles.pRef}>
                הזמין {data.referredNames.length}: {data.referredNames.slice(0, 4).join(', ')}
                {data.referredNames.length > 4 ? '…' : ''}
              </Text>
            ) : null}
          </Card>
        ) : null}

        {u ? (
          <Pressable onPress={toggleQa} disabled={qaSaving}>
            <Card style={[styles.qaCard, qa && styles.qaCardOn]}>
              <View style={styles.qaIcon}>
                <Ionicons
                  name={qa ? 'bug' : 'bug-outline'}
                  size={20}
                  color={qa ? colors.green : colors.textMuted}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.qaTitle}>בודק (QA)</Text>
                <Text style={styles.qaSub}>
                  {qa
                    ? 'מקבל פופאפ דיווח בצילום מסך באפליקציה'
                    : 'משתמש רגיל — ללא כלי בדיקה'}
                </Text>
              </View>
              {qaSaving ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <View style={[styles.qaSwitch, qa && styles.qaSwitchOn]}>
                  <View style={[styles.qaKnob, qa && styles.qaKnobOn]} />
                </View>
              )}
            </Card>
          </Pressable>
        ) : null}

        <SectionHeader>פעילות</SectionHeader>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
        ) : data && data.timeline.length ? (
          <Card>
            {data.timeline.map((e, i) => (
              <TimelineRow key={i} e={e} last={i === data.timeline.length - 1} />
            ))}
          </Card>
        ) : (
          <Text style={styles.empty}>אין פעילות מתועדת</Text>
        )}

        {data && data.errors.length ? (
          <>
            <SectionHeader>תקלות שהמשתמש חווה</SectionHeader>
            <Card style={{ gap: 2 }}>
              {data.errors.map((er) => {
                const emoji =
                  er.category === 'crash' ? '💥' : er.category === 'silent' ? '⚠️' : '❌';
                return (
                  <Pressable
                    key={er.id}
                    onPress={() =>
                      (nav as any).getParent()?.navigate('DevInbox', {
                        screen: 'ErrorDetail',
                        params: { id: er.id },
                      })
                    }
                    style={styles.errRow}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.errTitle} numberOfLines={1}>
                        {emoji} {er.title}
                      </Text>
                      <Text style={styles.errMeta}>
                        ×{er.count} · {timeAgo(er.lastSeen)}
                      </Text>
                    </View>
                    <View style={[styles.errBadge, { backgroundColor: BUG_STATUS[er.status].color + '22' }]}>
                      <Text style={[styles.errBadgeTxt, { color: BUG_STATUS[er.status].color }]}>
                        {BUG_STATUS[er.status].label}
                      </Text>
                    </View>
                    <Ionicons name="chevron-back" size={16} color={colors.textMuted} />
                  </Pressable>
                );
              })}
            </Card>
            <Text style={styles.errHint}>
              תקלות שקרו אצל המשתמש — לא מוצגות בציר הזמן.
            </Text>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...font.h2, flex: 1, textAlign: 'center' },
  scroll: { padding: 16, gap: 12, paddingBottom: 40 },
  profile: { gap: 4 },
  pName: { ...font.h1, fontSize: 22 },
  pSub: { ...font.body },
  pStats: { flexDirection: 'row', gap: 16, marginTop: 10 },
  stat: { alignItems: 'center' },
  statValue: { ...font.title, fontSize: 15 },
  statLabel: { ...font.small },
  pRef: { ...font.small, color: colors.textSoft, marginTop: 6 },
  inviteBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    paddingVertical: 10,
    marginTop: 10,
  },
  inviteCell: { flex: 1, alignItems: 'center' },
  inviteDiv: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border },
  inviteNum: { ...font.title, fontSize: 20, color: colors.primary },
  inviteLbl: { ...font.small, color: colors.textMuted, marginTop: 2 },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 9,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  copyBtnOn: { backgroundColor: colors.green, borderColor: colors.green },
  copyTxt: { ...font.title, fontSize: 13.5, color: colors.primary },
  // QA tester toggle
  qaCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  qaCardOn: { borderColor: colors.green, borderWidth: 1 },
  qaIcon: { width: 28, alignItems: 'center' },
  qaTitle: { ...font.title, fontSize: 15, textAlign: 'right' },
  qaSub: { ...font.small, color: colors.textMuted, marginTop: 1, textAlign: 'right' },
  qaSwitch: {
    width: 46,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.border,
    padding: 3,
    justifyContent: 'center',
  },
  qaSwitchOn: { backgroundColor: colors.green },
  qaKnob: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#fff',
    alignSelf: 'flex-start',
  },
  qaKnobOn: { alignSelf: 'flex-end' },
  empty: { ...font.body, color: colors.textMuted, textAlign: 'center', marginTop: 20 },
  // timeline
  tlRow: { flexDirection: 'row', gap: 12 },
  tlGutter: { alignItems: 'center', width: 26 },
  tlDot: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  tlLine: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 },
  tlBody: { flex: 1, paddingBottom: 16 },
  tlAction: { ...font.small, fontWeight: '700', marginBottom: 1 },
  tlTitle: { ...font.title, fontSize: 14 },
  tlSub: { ...font.small, color: colors.textSoft, marginTop: 1 },
  tlTime: { ...font.small, color: colors.textMuted, marginTop: 2 },
  // errors the user experienced
  errRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  errTitle: { ...font.title, fontSize: 13.5, textAlign: 'right' },
  errMeta: { ...font.small, color: colors.textMuted, marginTop: 1, textAlign: 'right' },
  errBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm },
  errBadgeTxt: { fontSize: 11, fontWeight: '800' },
  errHint: { ...font.small, color: colors.textMuted, marginTop: 6, textAlign: 'right' },
});
