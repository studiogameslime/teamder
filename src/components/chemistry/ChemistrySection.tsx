// "כימיה במועדון" — six pairs worth knowing about, inside the club statistics
// screen. Not a screen of its own: it sits beside the leaders and the fun
// facts, and a category with nothing behind it simply isn't drawn.
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PairChemistryIcon } from './PairChemistryIcon';

import { UserAvatar } from '@/components/UserAvatar';
import {
  CHEMISTRY_EMOJI,
  CHEMISTRY_LABEL,
  PairCard,
  type PairPerson,
} from '@/components/chemistry/PairCard';
import { clubChemistryService, type ClubChemistry } from '@/services/clubChemistryService';
import { groupService } from '@/services/groupService';
import {
  pairMembers,
  pickChemistry,
  type ChemistryPick,
  type PairTotals,
} from '@/utils/clubChemistry';
import { formatDateShort } from '@/utils/format';
import { logEvent, AnalyticsEvent } from '@/services/analyticsService';
import {
  clubAccent,
  clubCardTint,
  clubShadow,
  colors,
  spacing,
  typography,
  RTL_LABEL_ALIGN,
} from '@/theme';
import { he } from '@/i18n/he';

function headline(p: ChemistryPick): string {
  switch (p.kind) {
    case 'winningDuo': return he.chemistryWinsTogether(p.value);
    case 'regulars': return he.chemistryGamesTogether(p.value);
    case 'deadlyDuo': return he.chemistryAssistsBetween(p.value);
    case 'wall': return he.chemistryCleanSheetsTogether(p.value);
    case 'rivalry': return he.chemistryMeetings(p.value);
    case 'balancedRivalry':
      return p.balance
        ? `${he.chemistryBalancedLine(p.balance.winsA, p.balance.winsB)} · ${he.chemistryMeetings(p.value)}`
        : he.chemistryMeetings(p.value);
    case 'bestRatio': return he.chemistryWinRateTogether;
    case 'mostLosses': return he.chemistryLossesTogether(p.value);
  }
}

/** The big number on a card, already formatted. A rate carries its own sign. */
function metricText(p: ChemistryPick): string {
  return p.kind === 'bestRatio' ? `${p.value}%` : String(p.value);
}

/**
 * The five categories the club screen shows, IN ORDER.
 *
 * `pickChemistry` computes more than these — deadlyDuo and the rivalry are
 * still crowned, and the pair card still tags a pair with every title it
 * holds. This list decides only what the GRID draws, so narrowing it costs no
 * title and no data.
 */
const GRID_KINDS = ['winningDuo', 'regulars', 'bestRatio', 'mostLosses', 'wall'] as const;

/**
 * Each category's colour. The tint is the card's ground and the accent is its
 * title, its number and its icon — one hue per card, as in the reference.
 * Losses are the only red: the card is about a record nobody is chasing.
 */
/**
 * One colour per category, and one football glyph per category.
 *
 * The colour is DIFFERENTIATION, not a status code — an earlier pass forced
 * every non-semantic category to blue and turned this area into a row of
 * identical white boxes. The tint is 8%, measured off the reference's own
 * cards, and it works because the page under it is lighter than the tint.
 */
const KIND_STYLE: Record<
  (typeof GRID_KINDS)[number],
  { accent: string; icon: string }
> = {
  winningDuo: { accent: clubAccent.gold, icon: 'trophy' },
  regulars: { accent: clubAccent.blue, icon: 'people' },
  bestRatio: { accent: clubAccent.green, icon: 'disc' },
  mostLosses: { accent: clubAccent.red, icon: 'football' },
  wall: { accent: clubAccent.purple, icon: 'shield-checkmark' },
};

export function ChemistryLoadNotice({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  return <View style={styles.loadNotice} accessibilityLiveRegion="polite">
    <Text style={styles.empty}>{failed ? 'לא הצלחנו לטעון את נתוני הצמדים.' : 'טוענים את נתוני הצמדים…'}</Text>
    {failed ? <Pressable onPress={onRetry} accessibilityRole="button" style={styles.retry}>
      <Text style={styles.retryText}>נסה שוב</Text>
    </Pressable> : null}
  </View>;
}

/**
 * `pairs` decides WHICH window this section describes.
 *
 * Omitted, it fetches the live `communityPairStats` — the RUNNING season,
 * because a season close zeroes those documents. Supplied, it renders exactly
 * what it is given: a closed season's archived pairs, or every season summed.
 * The picking, the cards and the names are one code path either way; only the
 * numbers that go in differ, which is the point — a closed season's chemistry
 * must not be a second implementation that can disagree with the live one.
 */
export function ChemistrySection({
  groupId,
  pairs,
  seasonScoped = false,
  appearance,
  preview = false,
  motionEnabled = true,
}: {
  groupId: string;
  pairs?: Record<string, PairTotals> | null;
  /**
   * The caller has already named the window on screen — the scope chip says
   * "עונה 2 · עכשיו", and a season close is what zeroed these counters, so the
   * two dates are the same fact said twice.
   *
   * Suppresses the "הנתונים מ-DD.MM ואילך" line, and ONLY that line. See where
   * it renders for why it exists at all: it is not decoration, it is there so
   * a pair card's directional breakdown cannot be read against the wider
   * legacy total on the same documents. A club that runs no seasons has no
   * chip naming the window and keeps the line.
   */
  seasonScoped?: boolean;
  appearance?: 'club';
  preview?: boolean;
  motionEnabled?: boolean;
}) {
  const [loaded, setLoaded] = useState<{ groupId: string; source: typeof pairs; data: ClubChemistry | null; failed: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [people, setPeople] = useState<Record<string, PairPerson>>({});
  const [open, setOpen] = useState<[string, string] | null>(null);

  useEffect(() => {
    let alive = true;
    setLoaded(null);
    setPeople({});
    setOpen(null);
    (async () => {
      // `pairs === undefined` means "fetch the live ones"; `null` means the
      // caller has a scope selected whose pairs have not arrived yet, and it
      // must NOT fall through to the live fetch — that would put the running
      // season's chemistry under a closed season's heading, which is the
      // failure this screen has already had once with its table.
      try {
      // null is a scope still loading, never an empty result or a live read.
      if (pairs === null) return;
      const c =
        pairs === undefined
          ? await clubChemistryService.get(groupId, true)
          : { picks: pickChemistry(pairs ?? {}), pairs: pairs ?? {}, since: null };
      if (!alive) return;
      setLoaded({ groupId, source: pairs, data: c, failed: false });
      // Every name the section needs, in ONE batched read. Twelve players over
      // six cards would otherwise be twelve round trips on a screen that is
      // already fetching several other things.
      const ids = new Set<string>();
      for (const p of c.picks) {
        for (const k of p.pairs) {
          const [x, y] = pairMembers(k);
          if (!x.startsWith('guest:')) ids.add(x);
          if (!y.startsWith('guest:')) ids.add(y);
        }
      }
      if (ids.size === 0) return;
      const users = await groupService.hydrateUsers(Array.from(ids)).catch(() => []);
      if (!alive) return;
      const map: Record<string, PairPerson> = {};
      for (const u of users) {
        map[u.id] = { id: u.id, name: u.name, photoUrl: u.photoUrl, avatarId: u.avatarId };
      }
      setPeople(map);
      } catch {
        if (alive) setLoaded({ groupId, source: pairs, data: null, failed: true });
      }
    })();
    return () => {
      alive = false;
    };
  }, [groupId, pairs, attempt]);

  // Hide a previous club/scope synchronously, before its cleanup effect runs.
  const current = loaded?.groupId === groupId && loaded.source === pairs ? loaded : null;
  const data = current?.data ?? null;

  const person = useCallback(
    (id: string): PairPerson | null => people[id] ?? null,
    [people],
  );

  if (!data) return <ChemistryLoadNotice failed={current?.failed === true} onRetry={() => setAttempt(x => x + 1)} />;
  if (preview && !data.picks.some(p => p.kind === 'winningDuo')) return <></>;
  if (data.picks.length === 0) {
    return <Text style={styles.empty}>{he.chemistryEmpty}</Text>;
  }

  return (
    <>
      {/* Two columns, in the reference's order. A category with nobody behind
          it is not drawn at all, so a young club shows one or two cards rather
          than a grid of blanks — and the remaining cards still tile, because
          the row wraps rather than reserving slots. */}
      <View style={styles.grid}>
        {(() => {
          const drawn = GRID_KINDS.filter((k) => (!preview || k === 'winningDuo') && data.picks.some((x) => x.kind === k));
          return drawn;
        })().map((kind, idx, drawn) => {
          const p = data.picks.find((x) => x.kind === kind)!;
          const st = KIND_STYLE[kind];
          // An odd card at the end fills the row instead of sitting at half
          // width beside a hole. It keeps the same tint, the same shadow and
          // the same radius, and it is SHORTER than the cards above — the
          // reference draws it as a strip, not as a feature.
          const wide = drawn.length % 2 === 1 && idx === drawn.length - 1;
          // On a genuine tie the card shows the first pair and says so, rather
          // than inventing a winner or silently dropping the others.
          const [x, y] = pairMembers(p.pairs[0]);
          const px = person(x);
          const py = person(y);
          if (appearance === 'club') return <View key={kind} style={{ width: '100%', gap: 8 }}>
            {preview ? <Text style={styles.clubHeading}>צמד מנצח</Text> : null}
            <Pressable accessibilityRole="button" accessibilityLabel={`${CHEMISTRY_LABEL[kind]}: ${px?.name ?? ''} ${py?.name ?? ''}`} onPress={() => { logEvent(AnalyticsEvent.ScreenView, { screen: 'PairCard', kind }); setOpen([x, y]); }} style={({ pressed }) => [styles.clubPair, pressed && { opacity: 0.75 }]}>
              <View style={styles.clubPairTitle}>
                <Text style={styles.clubPairLabel}>{CHEMISTRY_LABEL[kind]}</Text>
                <Ionicons name="chevron-back" size={18} color="#687797" />
              </View>
              <View style={styles.clubPairBody}>
                <View style={styles.clubPairPlayer}>
                  {px ? <UserAvatar user={{ ...px, id: x }} size={72} /> : null}
                  <Text numberOfLines={2} style={styles.clubPairNames}>{px?.name ?? ''}</Text>
                </View>
                <View style={styles.clubPairLink}><PairChemistryIcon kind={kind} active={motionEnabled} delay={400 + idx * 120} /></View>
                <View style={styles.clubPairPlayer}>
                  {py ? <UserAvatar user={{ ...py, id: y }} size={72} /> : null}
                  <Text numberOfLines={2} style={styles.clubPairNames}>{py?.name ?? ''}</Text>
                </View>
              </View>
              <Text style={styles.clubPairMetric}>{p.kind === 'bestRatio' ? metricText(p) : headline(p)}</Text>
              {p.tied ? <Text style={styles.tied}>{he.chemistryTied}</Text> : null}
            </Pressable>
          </View>;
          return (
            <Pressable
              key={kind}
              style={({ pressed }) => [
                styles.card,
                wide && styles.cardWide,
                { backgroundColor: clubCardTint(st.accent) },
                pressed && styles.cardPressed,
              ]}
              onPress={() => {
                logEvent(AnalyticsEvent.ScreenView, { screen: 'PairCard', kind });
                setOpen([x, y]);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${CHEMISTRY_LABEL[kind]}: ${px?.name ?? ''} ${py?.name ?? ''}`}
            >
              <View style={styles.cardTop}>
                <Text style={[styles.cardTitle, { color: st.accent }]} numberOfLines={2}>
                  {CHEMISTRY_LABEL[kind]}
                </Text>
                <Ionicons name={st.icon as never} size={20} color={st.accent} />
              </View>

              <View style={styles.cardBody}>
                <View style={styles.cardText}>
                  <Text style={[styles.cardValue, { color: st.accent }]}>
                    {metricText(p)}
                  </Text>
                  <Text style={styles.cardMetric} numberOfLines={2}>
                    {headline(p)}
                  </Text>
                </View>
                {/* Overlapping, and the second sits UNDER the first so the
                    overlap always falls the same way whichever names are
                    longer. A white ring separates them from the tint. */}
                <View style={styles.avatars}>
                  {py ? (
                    <View style={[styles.avatarRing, styles.avatarBack]}>
                      <UserAvatar
                        user={{ id: y, name: py.name, avatarId: py.avatarId, photoUrl: py.photoUrl }}
                        size={34}
                      />
                    </View>
                  ) : null}
                  {px ? (
                    <View style={styles.avatarRing}>
                      <UserAvatar
                        user={{ id: x, name: px.name, avatarId: px.avatarId, photoUrl: px.photoUrl }}
                        size={34}
                      />
                    </View>
                  ) : null}
                </View>
              </View>

              <Text style={styles.cardNames} numberOfLines={1}>
                {`${px?.name ?? ''} + ${py?.name ?? ''}`}
              </Text>
              {p.tied ? <Text style={styles.tied}>{he.chemistryTied}</Text> : null}
            </Pressable>
          );
        })}
      </View>
      {/* The "הנתונים מ-DD.MM ואילך" line used to sit here and is gone on the
          owner's instruction. The pair card's own footer still carries it,
          where a reader is looking at one pair's numbers and the window
          actually qualifies something. */}

      <PairCard
        visible={open !== null}
        onClose={() => setOpen(null)}
        playerAId={open?.[0] ?? ''}
        playerBId={open?.[1] ?? ''}
        pairs={data.pairs}
        picks={data.picks}
        person={person}
        since={data.since}
      />
    </>
  );
}

const styles = StyleSheet.create({
  clubHeading: { fontSize: 18, fontWeight: '800', color: '#13213F', textAlign: RTL_LABEL_ALIGN, marginTop: 8 },
  clubPair: { width: '100%', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, gap: 10, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E0E8F0', alignItems: 'center' },
  clubPairTitle: { flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%' },
  clubPairLabel: { flex: 1, fontSize: 13, fontWeight: '700', color: '#13213F', textAlign: RTL_LABEL_ALIGN },
  clubPairBody: { width: '100%', flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  clubPairPlayer: { flex: 1, minWidth: 0, alignItems: 'center', gap: 6 },
  clubPairLink: { width: 44, height: 72, alignItems: 'center', justifyContent: 'center' },
  clubPairNames: { color: '#13213F', fontWeight: '800', fontSize: 14, textAlign: 'center', alignSelf: 'stretch' },
  clubPairMetric: { color: '#13213F', fontSize: 14, fontWeight: '600', textAlign: 'center', width: '100%', borderTopWidth: 1, borderTopColor: '#EAF0F5', paddingTop: 9 },
  loadNotice: { gap: spacing.sm },
  retry: { alignSelf: 'flex-start', paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: 12, backgroundColor: clubCardTint(clubAccent.blue) },
  retryText: { ...typography.label, color: colors.primary, textAlign: RTL_LABEL_ALIGN },
  // Centred, so an odd fifth card sits in the middle of its own row instead
  // of hanging at one edge beside a hole. A full row of two is unaffected —
  // the pair already fills the width.
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  card: {
    // Strictly two per row. A fifth card keeps its half width and is centred
    // by the grid — letting it grow to full width broke the grid and made the
    // odd card read as a different kind of thing from the four above it.
    flexGrow: 0,
    flexBasis: '48.5%',
    borderRadius: 16,
    padding: spacing.md,
    gap: 6,
    minHeight: 158,
    justifyContent: 'space-between',
    // Tint + shadow, no outline — the reference's pair cards have no border.
    ...clubShadow,
  },
  cardWide: {
    flexBasis: '100%',
    minHeight: 0,
  },
  cardPressed: { opacity: 0.75 },
  // Title leads on the right, icon closes on the left.
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  cardTitle: { fontSize: 13, fontWeight: '800', textAlign: RTL_LABEL_ALIGN, flexShrink: 1 },
  cardBody: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  cardText: { flexShrink: 1 },
  // The number is the first thing the eye lands on: bigger than the
  // category above it and far bigger than the names below.
  cardValue: { fontSize: 32, fontWeight: '900', textAlign: RTL_LABEL_ALIGN, letterSpacing: -0.5 },
  cardMetric: { fontSize: 12, color: '#64748B', textAlign: RTL_LABEL_ALIGN },
  avatars: { flexDirection: 'row', alignItems: 'center' },
  avatarRing: {
    borderRadius: 999,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: '#FFFFFF',
  },
  // Pulls the second avatar under the first. Negative margin on the BACK one,
  // so the front avatar keeps its full ring.
  avatarBack: { marginLeft: -14 },
  cardNames: { fontSize: 12, fontWeight: '600', color: '#64748B', textAlign: RTL_LABEL_ALIGN },
  tied: { fontSize: 10, color: colors.textMuted, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  since: { fontSize: 11, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN, marginTop: 2 },
  empty: { ...typography.body, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
});
