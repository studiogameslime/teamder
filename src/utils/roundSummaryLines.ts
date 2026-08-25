// Turning a sealed summary into Hebrew.
//
// Kept apart from the core on purpose: the core decides what is TRUE, this
// decides how to say it. That is what lets "beat the record" and "equalled the
// record" come from one structured fact with a `tied` flag, instead of two
// nearly-identical branches computing nearly-identical things.
//
// Every line is written NOMINALLY — "מתן — 100 שערים במועדון", not "מתן הגיע
// ל-100" — so nothing here has to guess a player's gender to form a verb.
import type {
  MilestoneMetric,
  RecordMetric,
  SummaryEvent,
} from '@/utils/roundSummary';
import { he } from '@/i18n/he';

export type LineTone = 'gold' | 'blue' | 'purple' | 'lime' | 'rose';

export interface SummaryLine {
  icon: string;
  text: string;
  tone: LineTone;
}

/** Resolve ids to display names. Unknown ids are dropped rather than shown raw. */
export type NameOf = (userId: string) => string | null;

function namesOf(userIds: string[], nameOf: NameOf): string | null {
  const names = userIds.map(nameOf).filter((n): n is string => !!n);
  if (names.length === 0) return null;
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} ו${names[1]}`;
  return he.summaryNamesAndMore(names[0], names[1], names.length - 2);
}

const RECORD_METRIC: Record<RecordMetric, string> = {
  goals: he.summaryMetricGoals,
  assists: he.summaryMetricAssists,
  involvement: he.summaryMetricInvolvement,
  cleanSheets: he.summaryMetricCleanSheets,
  wins: he.summaryMetricWins,
};

const MILESTONE_METRIC: Record<MilestoneMetric, string> = {
  goals: he.summaryMetricGoals,
  assists: he.summaryMetricAssists,
  cleanSheets: he.summaryMetricCleanSheets,
  wins: he.summaryMetricWins,
  rounds: he.summaryMetricRounds,
  evenings: he.summaryMetricEvenings,
  shootouts: he.summaryMetricShootouts,
};

const FIRST_EVER: Record<string, string> = {
  two_players_4_goals: he.summaryFirstTwoScorers,
  player_3_goals_3_assists: he.summaryFirstAllRound,
  all_teams_level: he.summaryFirstAllLevel,
  three_shootouts: he.summaryFirstThreeShootouts,
  multiple_personal_records: he.summaryFirstManyPersonalBests,
  every_team_won: he.summaryFirstEveryTeamWon,
};

/**
 * One line per event, in the order the core ranked them.
 *
 * An event whose names cannot be resolved is DROPPED, not rendered with an id:
 * a summary that says "‎x7Kq… — 100 שערים" is worse than one line shorter.
 */
export function summaryLines(
  events: SummaryEvent[],
  nameOf: NameOf,
): SummaryLine[] {
  const out: SummaryLine[] = [];
  for (const e of events) {
    switch (e.type) {
      case 'club_record': {
        const who = namesOf(e.userIds, nameOf);
        if (!who) break;
        const metric = RECORD_METRIC[e.metric];
        out.push(
          e.tied
            ? { icon: '🏅', tone: 'gold', text: he.summaryRecordTied(who, e.value, metric) }
            : { icon: '🏆', tone: 'gold', text: he.summaryRecordNew(who, e.value, metric, e.previousValue) },
        );
        break;
      }
      case 'personal_record': {
        const who = namesOf(e.userIds, nameOf);
        if (!who) break;
        const metric = RECORD_METRIC[e.metric];
        out.push({
          icon: '🔥',
          tone: 'rose',
          text: e.tied
            ? he.summaryPersonalTied(who, e.value, metric)
            : he.summaryPersonalNew(who, e.value, metric),
        });
        break;
      }
      case 'club_milestone':
        out.push({
          icon: '🏛️',
          tone: 'purple',
          text: he.summaryClubMilestone(e.threshold, MILESTONE_METRIC[e.metric]),
        });
        break;
      case 'player_milestone': {
        const who = namesOf(e.userIds, nameOf);
        if (!who) break;
        out.push({
          icon: '⚽',
          tone: 'blue',
          text: he.summaryPlayerMilestone(who, e.threshold, MILESTONE_METRIC[e.metric]),
        });
        break;
      }
      case 'rank_first_place': {
        const who = namesOf(e.userIds, nameOf);
        if (!who) break;
        out.push({ icon: '🥇', tone: 'gold', text: he.summaryNewLeader(who) });
        break;
      }
      case 'rank_jump': {
        const who = namesOf(e.userIds, nameOf);
        if (!who) break;
        out.push({ icon: '📈', tone: 'lime', text: he.summaryRankJump(who, e.from - e.to, e.to) });
        break;
      }
      case 'rank_top_entry': {
        const who = namesOf(e.userIds, nameOf);
        if (!who) break;
        out.push({ icon: '📈', tone: 'lime', text: he.summaryTopEntry(who, e.tier) });
        break;
      }
      case 'rank_tight_top': {
        const parts = e.entries
          .map((x) => {
            const nm = nameOf(x.userId);
            return nm ? `${nm} ${x.score}` : null;
          })
          .filter((x): x is string => !!x);
        if (parts.length < 2) break;
        out.push({ icon: '🔥', tone: 'rose', text: he.summaryTightTop(parts.join(' · ')) });
        break;
      }
      case 'first_ever': {
        const text = FIRST_EVER[e.code];
        if (!text) break;
        out.push({ icon: '🎉', tone: 'purple', text });
        break;
      }
    }
  }
  return out;
}
