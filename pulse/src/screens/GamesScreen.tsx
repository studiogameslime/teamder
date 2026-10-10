// GamesScreen — UPCOMING / now games (not past) with registration counts AND
// a managerial activity read-out per game: timer started? mini-games played?
// live right now? Tap a card to expand the FULL creation data: how teams were
// formed, every setting the admin enabled, field, logistics and access rules.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import { Card, Empty, Screen, StatTile } from '../components/ui';
import { fetchGames, type GameDetail, type GameRow, type GamesReport } from '../services/gamesService';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function timeHe(ms: number): string {
  if (!ms) return 'ללא תאריך';
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} · ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function dateHe(ms: number | null): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const VIS_HE: Record<GameRow['visibility'], string> = {
  public: 'ציבורי',
  community: 'מועדון',
  private: 'פרטי',
};
const METHOD_HE: Record<string, string> = {
  snake: 'נחש (תור-תור)',
  manual: 'ידני לפי קפטנים',
  random: 'אקראי',
  rating: 'לפי דירוג פנימי',
};
const FILLMODE_HE: Record<string, string> = {
  auto: 'אוטומטי', manual: 'ידני', off: 'כבוי', none: 'ללא',
};
const TIEMODE_HE: Record<string, string> = {
  none: 'ללא', draw: 'תיקו', penalties: 'פנדלים', goldenGoal: 'גול זהב', stay: 'המנצח נשאר',
};
const COLOR_HE: Record<string, string> = {
  red: 'אדומים', blue: 'כחולים', green: 'ירוקים', yellow: 'צהובים',
  orange: 'כתומים', purple: 'סגולים', black: 'שחורים', white: 'לבנים',
};

const ACTIVITY_META: Record<
  GameRow['activity'],
  { label: string; tint: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  live: { label: 'חי עכשיו', tint: colors.red, icon: 'radio' },
  played: { label: 'שוחק', tint: colors.green, icon: 'checkmark-circle' },
  teams: { label: 'כוחות חולקו', tint: colors.amber, icon: 'people' },
  idle: { label: 'לא התחיל', tint: colors.textMuted, icon: 'time-outline' },
};

type Filter = 'all' | 'live' | 'locked';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'הכל' },
  { key: 'live', label: 'חי עכשיו' },
  { key: 'locked', label: 'נעולים / מועדון' },
];

function Pill({ text, tint }: { text: string; tint: string }) {
  return (
    <View style={[st.pill, { backgroundColor: tint + '22', borderColor: tint + '55' }]}>
      <Text style={[st.pillTxt, { color: tint }]}>{text}</Text>
    </View>
  );
}
function Chip({ text, on }: { text: string; on: boolean }) {
  return (
    <View style={[st.chip, on && st.chipOn]}>
      <Ionicons name={on ? 'checkmark' : 'close'} size={11} color={on ? colors.green : colors.textMuted} />
      <Text style={[st.chipTxt, on && { color: colors.text }]}>{text}</Text>
    </View>
  );
}

/** A labelled key/value line in the expanded detail. Hidden when value is null. */
function Row({ label, value }: { label: string; value: string | null }) {
  if (value == null || value === '') return null;
  return (
    <View style={st.detRow}>
      <Text style={st.detVal}>{value}</Text>
      <Text style={st.detLbl}>{label}</Text>
    </View>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const kids = React.Children.toArray(children).filter(Boolean);
  if (kids.length === 0) return null;
  return (
    <View style={st.section}>
      <Text style={st.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const yn = (v: boolean) => (v ? 'כן' : 'לא');
const min = (v: number | null) => (v != null ? `${v} דק׳` : null);

function DetailView({ d }: { d: GameDetail }) {
  const genLabel =
    d.autoGenBy === 'system'
      ? 'נוצר אוטומטית (מתוזמן)'
      : d.autoGenBy
        ? 'נוצר ע״י אדמין (איזון)'
        : d.teamsMethod
          ? 'חלוקה ידנית'
          : null;
  return (
    <View style={st.detail}>
      <Section title="כוחות">
        <Row label="שיטת חלוקה" value={d.teamsMethod ? METHOD_HE[d.teamsMethod] ?? d.teamsMethod : 'לא חולקו'} />
        <Row label="כיצד נוצרו" value={genLabel} />
        <Row label="מספר קבוצות" value={d.numberOfTeams != null ? String(d.numberOfTeams) : null} />
        <Row label="נערך ידנית אחרי" value={d.teams.length ? yn(d.teamsEdited) : null} />
        {d.teams.length > 0 ? (
          <View style={st.teamChips}>
            {d.teams.map((t) => (
              <View key={t.index} style={st.teamChip}>
                <Text style={st.teamChipTxt}>
                  {t.colorKey ? COLOR_HE[t.colorKey] ?? t.colorKey : `קבוצה ${t.index + 1}`} · {t.count}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </Section>

      <Section title="הגדרות משחק">
        <Row label="פורמט" value={d.format} />
        <Row label="משך משחק" value={min(d.durationMin)} />
        <Row label="זמן נוסף" value={d.extraMin ? min(d.extraMin) : null} />
        <Row label="מחצית" value={yn(d.halfTime)} />
        <Row label="פנדלים" value={yn(d.penalties)} />
        <Row label="שופט" value={yn(d.referee)} />
        <Row label="מצב מילוי (מתקדם)" value={d.fillMode ? FILLMODE_HE[d.fillMode] ?? d.fillMode : null} />
        <Row label="הכרעת תיקו" value={d.tieMode ? TIEMODE_HE[d.tieMode] ?? d.tieMode : null} />
      </Section>

      <Section title="הרשמה וגישה">
        <Row label="מקס׳ שחקנים" value={d.maxPlayers != null ? String(d.maxPlayers) : null} />
        <Row label="מינ׳ שחקנים" value={d.minPlayers != null ? String(d.minPlayers) : null} />
        <Row label="דורש אישור מנהל" value={yn(d.requiresApproval)} />
        <Row label="סף אמון מינ׳ לזרים" value={d.fillerMinTrust != null ? String(d.fillerMinTrust) : null} />
        <Row label="פתיחת הרשמה" value={d.registrationOpensAt ? dateHe(d.registrationOpensAt) : null} />
        <Row label="פתיחה לציבור" value={d.publicOpenAt ? dateHe(d.publicOpenAt) : null} />
        <Row label="פתיחה לאורחים" value={d.guestsOpenAt ? dateHe(d.guestsOpenAt) : null} />
        <Row label="חלוקת כוחות אוטומטית ב-" value={d.autoTeamsAt ? dateHe(d.autoTeamsAt) : null} />
        <Row label="דדליין ביטול" value={d.cancelDeadlineHours != null ? `${d.cancelDeadlineHours} ש׳ לפני` : null} />
      </Section>

      <Section title="מגרש">
        <Row label="שם מגרש" value={d.fieldName} />
        <Row label="כתובת" value={d.fieldAddress} />
        <Row label="עיר" value={d.city} />
        <Row label="סוג משטח" value={d.fieldType} />
      </Section>

      <Section title="לוגיסטיקה">
        <Row label="להביא כדור" value={yn(d.bringBall)} />
        <Row label="להביא חולצות" value={yn(d.bringShirts)} />
        <Row label="חוקי מגרש" value={d.ruleTags.length ? d.ruleTags.join(' · ') : null} />
        <Row label="הערות" value={d.notes} />
      </Section>

      <Section title="כללי">
        <Row label="הגיעו בפועל (סומנו)" value={d.arrivals ? String(d.arrivals) : null} />
        <Row label="ביטולים" value={d.cancellations ? String(d.cancellations) : null} />
        <Row label="נוצר בתאריך" value={d.createdAt ? dateHe(d.createdAt) : null} />
      </Section>
    </View>
  );
}

function GameCard({ g }: { g: GameRow }) {
  const [open, setOpen] = useState(false);
  const isLocked = g.locked || g.visibility !== 'public';
  const full = g.capacity > 0 && g.registered >= g.capacity;
  const act = ACTIVITY_META[g.activity];
  const hasScore = g.scoreA + g.scoreB > 0;
  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((o) => !o);
  };
  return (
    <Card style={st.card}>
      <Pressable onPress={toggle} style={{ gap: 7 }}>
        <View style={st.titleRow}>
          <Text style={st.title} numberOfLines={1}>
            {g.title}
          </Text>
          {isLocked ? <Ionicons name="lock-closed" size={15} color={colors.amber} /> : null}
          <View style={[st.actBadge, { backgroundColor: act.tint }]}>
            <Ionicons name={act.icon} size={12} color="#fff" />
            <Text style={st.actTxt}>{act.label}</Text>
          </View>
        </View>
        <View style={st.subRow}>
          <Text style={st.date}>{timeHe(g.startsAt)}</Text>
          {g.communityName ? <Text style={st.community}> · {g.communityName}</Text> : null}
          <View style={{ flex: 1 }} />
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
        </View>

        {/* Registration */}
        <View style={st.countsRow}>
          <Text style={[st.bigCount, full && { color: colors.green }]}>
            {g.registered}
            {g.capacity > 0 ? <Text style={st.capacity}>/{g.capacity}</Text> : null}
          </Text>
          <Text style={st.countLbl}>נרשמו</Text>
          {g.waitlist > 0 ? <Pill text={`המתנה ${g.waitlist}`} tint={colors.amber} /> : null}
          {g.pending > 0 ? <Pill text={`לאישור ${g.pending}`} tint={colors.primary} /> : null}
          {g.guests > 0 ? <Pill text={`אורחים ${g.guests}`} tint={colors.textMuted} /> : null}
        </View>

        {/* Managerial activity */}
        <View style={st.chipRow}>
          <Chip text={g.advancedMode ? 'מתקדם' : 'טיימר בלבד'} on={g.advancedMode} />
          <Chip text="כוחות חולקו" on={g.teamsDivided} />
          <Chip text="טיימר הופעל" on={g.timerStarted} />
          {g.roundsPlayed > 0 ? (
            <Pill text={`${g.roundsPlayed} משחקונים`} tint={colors.green} />
          ) : (
            <Chip text="משחקונים" on={false} />
          )}
          {hasScore ? <Pill text={`תוצאה ${g.scoreA}-${g.scoreB}`} tint={colors.primary} /> : null}
        </View>

        {/* Visibility / settings */}
        <View style={st.badgeRow}>
          <Pill text={VIS_HE[g.visibility]} tint={g.visibility === 'public' ? colors.green : colors.amber} />
          {g.acceptsFillers ? <Pill text="פתוח לזרים" tint="#06B6D4" /> : null}
          {g.locked ? <Pill text="נעול" tint={colors.red} /> : null}
        </View>
      </Pressable>

      {open ? <DetailView d={g.detail} /> : null}
    </Card>
  );
}

export function GamesScreen() {
  const [report, setReport] = useState<GamesReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    const r = await fetchGames().catch(() => null);
    setReport(r);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    const all = report?.rows ?? [];
    if (filter === 'live') return all.filter((g) => g.runningNow);
    if (filter === 'locked') return all.filter((g) => g.locked || g.visibility !== 'public');
    return all;
  }, [report, filter]);

  return (
    <Screen
      title="משחקים"
      subtitle="קרובים ופעילים — נרשמים, סטטוס ניהולי ופירוט מלא בלחיצה"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
        />
      }
    >
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : !report ? (
        <Empty text="לא הצלחנו לטעון משחקים" />
      ) : (
        <>
          <View style={st.tiles}>
            <StatTile label="משחקים קרובים" value={String(report.totalGames)} />
            <StatTile label="סה״כ נרשמו" value={String(report.totalRegistered)} tone="green" />
            <StatTile
              label="חי עכשיו"
              value={String(report.liveNow)}
              tone={report.liveNow > 0 ? 'red' : 'default'}
            />
          </View>

          <View style={st.filters}>
            {FILTERS.map((f) => (
              <Pressable
                key={f.key}
                onPress={() => setFilter(f.key)}
                style={[st.filterBtn, filter === f.key && st.filterOn]}
              >
                <Text style={[st.filterTxt, filter === f.key && st.filterTxtOn]}>{f.label}</Text>
              </Pressable>
            ))}
          </View>

          {rows.length === 0 ? (
            <Empty text="אין משחקים קרובים בקטגוריה הזו" />
          ) : (
            rows.map((g) => <GameCard key={g.id} g={g} />)
          )}
        </>
      )}
    </Screen>
  );
}

const st = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  filters: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  filterBtn: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterTxt: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
  filterTxtOn: { color: '#fff' },
  card: { marginBottom: 10, gap: 7 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { flex: 1, color: colors.text, fontSize: 16, fontWeight: '800', textAlign: 'right' },
  actBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 999,
  },
  actTxt: { color: '#fff', fontSize: 11, fontWeight: '800' },
  subRow: { flexDirection: 'row', alignItems: 'center' },
  date: { color: colors.textMuted, fontSize: 12, textAlign: 'right' },
  community: { color: colors.textSoft, fontSize: 12, fontWeight: '700' },
  countsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  bigCount: { color: colors.text, fontSize: 22, fontWeight: '900' },
  capacity: { color: colors.textMuted, fontSize: 15, fontWeight: '700' },
  countLbl: { color: colors.textMuted, fontSize: 12, marginInlineEnd: 4 },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipOn: { borderColor: colors.green + '66', backgroundColor: colors.green + '14' },
  chipTxt: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  pill: { paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, borderWidth: 1 },
  pillTxt: { fontSize: 11, fontWeight: '700' },
  // expanded detail
  detail: { marginTop: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border, gap: 14 },
  section: { gap: 5 },
  sectionTitle: { color: colors.primary, fontSize: 12.5, fontWeight: '900', textAlign: 'right' },
  detRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 2,
  },
  detLbl: { color: colors.textMuted, fontSize: 13, textAlign: 'right' },
  detVal: { color: colors.text, fontSize: 13, fontWeight: '700', textAlign: 'left', flexShrink: 1 },
  teamChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4, justifyContent: 'flex-end' },
  teamChip: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  teamChipTxt: { color: colors.text, fontSize: 12, fontWeight: '700' },
});
