// "כימיה במועדון" — six pairs worth knowing about, inside the club statistics
// screen. Not a screen of its own: it sits beside the leaders and the fun
// facts, and a category with nothing behind it simply isn't drawn.
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { UserAvatar } from '@/components/UserAvatar';
import {
  CHEMISTRY_EMOJI,
  CHEMISTRY_LABEL,
  PairCard,
  type PairPerson,
} from '@/components/chemistry/PairCard';
import { clubChemistryService, type ClubChemistry } from '@/services/clubChemistryService';
import { groupService } from '@/services/groupService';
import { pairMembers, type ChemistryPick } from '@/utils/clubChemistry';
import { formatDateShort } from '@/utils/format';
import { logEvent, AnalyticsEvent } from '@/services/analyticsService';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
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
  }
}

export function ChemistrySection({ groupId }: { groupId: string }) {
  const [data, setData] = useState<ClubChemistry | null>(null);
  const [people, setPeople] = useState<Record<string, PairPerson>>({});
  const [open, setOpen] = useState<[string, string] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const c = await clubChemistryService.get(groupId);
      if (!alive) return;
      setData(c);
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
    })();
    return () => {
      alive = false;
    };
  }, [groupId]);

  const person = useCallback(
    (id: string): PairPerson | null => people[id] ?? null,
    [people],
  );

  if (!data) return null;
  if (data.picks.length === 0) {
    return <Text style={styles.empty}>{he.chemistryEmpty}</Text>;
  }

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {data.picks.map((p) => {
          // On a genuine tie the card shows the first pair and says so, rather
          // than inventing a winner or silently dropping the others.
          const [x, y] = pairMembers(p.pairs[0]);
          const px = person(x);
          const py = person(y);
          return (
            <Pressable
              key={p.kind}
              style={styles.card}
              onPress={() => {
                logEvent(AnalyticsEvent.ScreenView, { screen: 'PairCard', kind: p.kind });
                setOpen([x, y]);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${CHEMISTRY_LABEL[p.kind]}: ${px?.name ?? ''} ${py?.name ?? ''}`}
            >
              <Text style={styles.cardTitle}>
                {`${CHEMISTRY_EMOJI[p.kind]} ${CHEMISTRY_LABEL[p.kind]}`}
              </Text>
              <View style={styles.avatars}>
                {px ? <UserAvatar user={{ id: x, name: px.name, avatarId: px.avatarId, photoUrl: px.photoUrl }} size={38} /> : null}
                {py ? <UserAvatar user={{ id: y, name: py.name, avatarId: py.avatarId, photoUrl: py.photoUrl }} size={38} /> : null}
              </View>
              <Text style={styles.cardNames} numberOfLines={2}>
                {`${px?.name ?? ''} + ${py?.name ?? ''}`}
              </Text>
              <Text style={styles.cardValue}>{headline(p)}</Text>
              {p.tied ? <Text style={styles.tied}>{he.chemistryTied}</Text> : null}
            </Pressable>
          );
        })}
      </ScrollView>
      {data.since ? (
        <Text style={styles.since}>{he.chemistrySince(formatDateShort(data.since))}</Text>
      ) : null}

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
  row: { gap: spacing.sm, paddingVertical: spacing.xs },
  card: {
    width: 150,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 6,
    alignItems: 'center',
  },
  cardTitle: { fontSize: 12, fontWeight: '800', color: colors.textMuted, textAlign: 'center' },
  avatars: { flexDirection: 'row', gap: -6 },
  cardNames: { fontSize: 13, fontWeight: '800', color: colors.text, textAlign: 'center' },
  cardValue: { fontSize: 13, fontWeight: '700', color: colors.primary, textAlign: 'center' },
  tied: { fontSize: 10, color: colors.textMuted, fontWeight: '700' },
  since: { fontSize: 11, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN, marginTop: 2 },
  empty: { ...typography.body, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
});
