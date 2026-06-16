// In-app "screenshots" for the pre-sign-in onboarding. Instead of shipping
// brittle PNG captures (which drift every redesign and look fuzzy on big
// screens), each slide renders a crisp miniature of a real app surface inside
// a phone frame, populated with rich demo data so the app looks full and alive
// before the user signs up. Pure presentational — hardcoded Hebrew demo
// content, no data fetching.

import React from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const { width: SCREEN_W } = Dimensions.get('window');
// Keep the frame comfortably inside the slide gutters on small phones.
const FRAME_W = Math.min(248, SCREEN_W * 0.64);
const FRAME_H = FRAME_W * 1.74;

// Mini surface palette — fixed light tones so the "screenshot" reads as the
// real (light-theme) app regardless of the device's system scheme.
const C = {
  bg: '#F4F6FB',
  card: '#FFFFFF',
  text: '#111827',
  muted: '#6B7280',
  line: '#EEF1F6',
  blue: '#1E40AF',
  blueSoft: '#DBEAFE',
  green: '#16A34A',
  greenSoft: '#DCFCE7',
  amber: '#F59E0B',
  amberSoft: '#FEF3C7',
  red: '#EF4444',
  team1: '#2563EB',
  team2: '#DC2626',
  team3: '#16A34A',
};

const AV_TINTS = ['#2563EB', '#DC2626', '#16A34A', '#7C3AED', '#F59E0B', '#0EA5E9', '#DB2777'];

// ── Phone frame ────────────────────────────────────────────────────────────
export function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.frameOuter}>
      <View style={styles.frame}>
        <View style={styles.notch} />
        <View style={styles.screen}>{children}</View>
      </View>
    </View>
  );
}

// ── Small building blocks ────────────────────────────────────────────────────
function Avatar({ name, size = 18, idx = 0 }: { name: string; size?: number; idx?: number }) {
  const tint = AV_TINTS[idx % AV_TINTS.length];
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: tint },
      ]}
    >
      <Text style={[styles.avatarTxt, { fontSize: size * 0.5 }]}>{name.charAt(0)}</Text>
    </View>
  );
}

function AvatarStack({ names }: { names: string[] }) {
  return (
    <View style={styles.stack}>
      {names.map((n, i) => (
        <View key={i} style={{ marginInlineStart: i === 0 ? 0 : -7 }}>
          <Avatar name={n} idx={i} />
        </View>
      ))}
    </View>
  );
}

function FillBar({ pct, color }: { pct: number; color: string }) {
  return (
    <View style={styles.fillTrack}>
      <View style={[styles.fillFill, { width: `${pct * 100}%`, backgroundColor: color }]} />
    </View>
  );
}

function MiniHeader({ title }: { title: string }) {
  return (
    <View style={styles.miniHeader}>
      <Text style={styles.miniHeaderTxt}>{title}</Text>
    </View>
  );
}

// ── Preview 1: find games nearby ─────────────────────────────────────────────
const GAMES = [
  { title: 'כדורגל ערב · פארק הירקון', when: 'היום 20:00', dist: '1.2 ק״מ', have: 9, max: 10, hot: true, names: ['ד', 'י', 'א', 'ר'] },
  { title: 'חמש חמש · אצטדיון השכונה', when: 'מחר 19:30', dist: '2.4 ק״מ', have: 6, max: 10, hot: false, names: ['ע', 'מ', 'ש'] },
  { title: 'משחק שבת בבוקר', when: 'שבת 08:00', dist: '3.1 ק״מ', have: 8, max: 12, hot: false, names: ['נ', 'ל', 'ק', 'ב'] },
];

export function PreviewMatches() {
  return (
    <PhoneFrame>
      <MiniHeader title="משחקים לידך" />
      <View style={styles.body}>
        {GAMES.map((g, i) => {
          const pct = g.have / g.max;
          const barColor = g.hot ? C.amber : pct >= 1 ? C.red : C.green;
          return (
            <View key={i} style={styles.gameCard}>
              <View style={[styles.gameStrip, { backgroundColor: barColor }]} />
              <View style={styles.gameMain}>
                <Text style={styles.gameTitle} numberOfLines={1}>{g.title}</Text>
                <View style={styles.metaRow}>
                  <Ionicons name="time-outline" size={9} color={C.muted} />
                  <Text style={styles.metaTxt}>{g.when}</Text>
                  <Ionicons name="location-outline" size={9} color={C.muted} />
                  <Text style={styles.metaTxt}>{g.dist}</Text>
                </View>
                <View style={styles.gameFoot}>
                  <AvatarStack names={g.names} />
                  <View style={styles.fillWrap}>
                    <FillBar pct={pct} color={barColor} />
                    <Text style={[styles.fillTxt, { color: barColor }]}>{g.have}/{g.max}</Text>
                  </View>
                </View>
                {g.hot ? (
                  <View style={styles.hotChip}>
                    <Text style={styles.hotChipTxt}>🔥 מתמלא מהר · נשאר 1</Text>
                  </View>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    </PhoneFrame>
  );
}

// ── Preview 2: regular club + auto weekly cycle ──────────────────────────────
export function PreviewClub() {
  const roster = ['דני', 'יוסי', 'אבי', 'רון', 'עידו', 'משה', 'שי', 'ניר', 'ליאור', 'קובי', 'בר', 'גיא'];
  return (
    <PhoneFrame>
      <MiniHeader title="המועדון שלי" />
      <View style={styles.body}>
        <View style={styles.clubHero}>
          <View style={styles.clubCrest}>
            <Ionicons name="shield" size={20} color="#FFFFFF" />
          </View>
          <Text style={styles.clubName}>נבחרת השכונה</Text>
          <Text style={styles.clubMembers}>12 חברים קבועים</Text>
          <View style={styles.recurBadge}>
            <Ionicons name="sync" size={9} color={C.green} />
            <Text style={styles.recurTxt}>מחזור שבועי · יום ג׳ 20:00</Text>
          </View>
        </View>
        <Text style={styles.sectionLabel}>הסגל</Text>
        <View style={styles.rosterGrid}>
          {roster.map((n, i) => (
            <View key={i} style={styles.rosterCell}>
              <Avatar name={n} size={26} idx={i} />
              <Text style={styles.rosterName} numberOfLines={1}>{n}</Text>
            </View>
          ))}
        </View>
        <View style={styles.autoOpenChip}>
          <Ionicons name="checkmark-circle" size={11} color={C.green} />
          <Text style={styles.autoOpenTxt}>המחזור הבא נפתח אוטומטית — הזמנה נשלחה לכולם</Text>
        </View>
      </View>
    </PhoneFrame>
  );
}

// ── Preview 3: live flow — auto-fill + live rotation with wins ────────────────
export function PreviewLive() {
  const teamA = ['דני', 'יוסי', 'אבי', 'רון', 'עידו'];
  const teamB = ['משה', 'שי', 'ניר', 'ליאור', 'קובי'];
  return (
    <PhoneFrame>
      <MiniHeader title="משחק חי" />
      <View style={styles.body}>
        <View style={styles.fillToast}>
          <Ionicons name="flash" size={11} color={C.blue} />
          <Text style={styles.fillToastTxt}>בר ביטל — המקום התמלא אוטומטית ✓</Text>
        </View>

        <View style={styles.rotCard}>
          <Text style={styles.rotTitle}>על המגרש עכשיו</Text>
          <View style={styles.rotTeams}>
            <View style={styles.rotCol}>
              <View style={styles.rotHead}>
                <Text style={[styles.rotTeamName, { color: C.team1 }]}>קבוצה א</Text>
                <Text style={styles.rotWins}>🏆 2</Text>
              </View>
              {teamA.map((n, i) => (
                <View key={i} style={styles.rotRow}>
                  <Avatar name={n} size={15} idx={i} />
                  <Text style={styles.rotName} numberOfLines={1}>{n}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.vs}>VS</Text>
            <View style={styles.rotCol}>
              <View style={styles.rotHead}>
                <Text style={[styles.rotTeamName, { color: C.team2 }]}>קבוצה ב</Text>
              </View>
              {teamB.map((n, i) => (
                <View key={i} style={styles.rotRow}>
                  <Avatar name={n} size={15} idx={i + 3} />
                  <Text style={styles.rotName} numberOfLines={1}>{n}</Text>
                </View>
              ))}
            </View>
          </View>
          <View style={styles.waitRow}>
            <Ionicons name="hourglass-outline" size={9} color={C.muted} />
            <Text style={styles.waitTxt}>ממתינות: קבוצה ג</Text>
          </View>
        </View>

        <View style={styles.timerPill}>
          <Ionicons name="stopwatch-outline" size={11} color="#FFFFFF" />
          <Text style={styles.timerTxt}>12:34</Text>
        </View>
      </View>
    </PhoneFrame>
  );
}

const styles = StyleSheet.create({
  // Frame
  frameOuter: { alignItems: 'center', justifyContent: 'center' },
  frame: {
    width: FRAME_W,
    height: FRAME_H,
    borderRadius: 30,
    backgroundColor: '#0B1220',
    padding: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.35,
    shadowRadius: 22,
    elevation: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  notch: {
    position: 'absolute',
    top: 10,
    alignSelf: 'center',
    width: FRAME_W * 0.32,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.25)',
    zIndex: 2,
  },
  screen: { flex: 1, borderRadius: 25, backgroundColor: C.bg, overflow: 'hidden' },
  body: { flex: 1, paddingHorizontal: 8, paddingTop: 6, gap: 7 },

  // Header
  miniHeader: {
    paddingTop: 20,
    paddingBottom: 8,
    paddingHorizontal: 10,
    backgroundColor: C.blue,
  },
  miniHeaderTxt: { color: '#FFFFFF', fontWeight: '800', fontSize: 13, textAlign: 'right' },

  // Avatars
  avatar: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FFFFFF' },
  avatarTxt: { color: '#FFFFFF', fontWeight: '800' },
  stack: { flexDirection: 'row', alignItems: 'center' },

  // Fill bar
  fillTrack: { flex: 1, height: 4, borderRadius: 2, backgroundColor: C.line, overflow: 'hidden' },
  fillFill: { height: '100%', borderRadius: 2 },
  fillTxt: { fontSize: 8, fontWeight: '800' },

  // Game cards
  gameCard: {
    flexDirection: 'row',
    backgroundColor: C.card,
    borderRadius: 11,
    overflow: 'hidden',
    shadowColor: '#1E293B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  gameStrip: { width: 4 },
  gameMain: { flex: 1, padding: 7, gap: 4 },
  gameTitle: { fontSize: 11, fontWeight: '800', color: C.text, textAlign: 'right' },
  metaRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 3 },
  metaTxt: { fontSize: 8.5, color: C.muted, fontWeight: '600' },
  gameFoot: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  fillWrap: { flex: 1, flexDirection: 'row-reverse', alignItems: 'center', gap: 5 },
  hotChip: { alignSelf: 'flex-end', backgroundColor: C.amberSoft, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  hotChipTxt: { fontSize: 8, fontWeight: '800', color: '#B45309' },

  // Club
  clubHero: { backgroundColor: C.card, borderRadius: 12, alignItems: 'center', padding: 10, gap: 3 },
  clubCrest: { width: 36, height: 36, borderRadius: 12, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  clubName: { fontSize: 13, fontWeight: '800', color: C.text },
  clubMembers: { fontSize: 9, color: C.muted, fontWeight: '600' },
  recurBadge: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, backgroundColor: C.greenSoft, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, marginTop: 3 },
  recurTxt: { fontSize: 8.5, fontWeight: '800', color: '#15803D' },
  sectionLabel: { fontSize: 9.5, fontWeight: '800', color: C.muted, textAlign: 'right', marginTop: 1 },
  rosterGrid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-start' },
  rosterCell: { width: '21%', alignItems: 'center', gap: 2 },
  rosterName: { fontSize: 7.5, color: C.text, fontWeight: '600' },
  autoOpenChip: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, backgroundColor: C.card, borderRadius: 9, padding: 7, marginTop: 'auto', marginBottom: 8 },
  autoOpenTxt: { flex: 1, fontSize: 8.5, color: C.text, fontWeight: '600', textAlign: 'right' },

  // Live
  fillToast: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, backgroundColor: C.blueSoft, borderRadius: 9, padding: 7 },
  fillToastTxt: { flex: 1, fontSize: 9, color: C.blue, fontWeight: '800', textAlign: 'right' },
  rotCard: { backgroundColor: C.card, borderRadius: 12, padding: 8, gap: 6 },
  rotTitle: { fontSize: 10, fontWeight: '800', color: C.text, textAlign: 'right' },
  rotTeams: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  rotCol: { flex: 1, gap: 3 },
  rotHead: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  rotTeamName: { fontSize: 9.5, fontWeight: '800' },
  rotWins: { fontSize: 9, fontWeight: '800', color: C.text },
  rotRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4 },
  rotName: { flex: 1, fontSize: 8.5, color: C.text, fontWeight: '600', textAlign: 'right' },
  vs: { fontSize: 8, fontWeight: '800', color: C.muted, paddingTop: 16 },
  waitRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 5 },
  waitTxt: { fontSize: 8.5, color: C.muted, fontWeight: '700' },
  timerPill: { flexDirection: 'row-reverse', alignSelf: 'center', alignItems: 'center', gap: 5, backgroundColor: C.blue, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, marginTop: 'auto', marginBottom: 8 },
  timerTxt: { color: '#FFFFFF', fontWeight: '800', fontSize: 12, fontVariant: ['tabular-nums'] },
});
