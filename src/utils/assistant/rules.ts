// הודעה מהמאמן — the rules.
//
// Each rule is a pure `(context) => message | null`. Adding a scenario means
// writing one function and appending it to ASSISTANT_RULES; nothing else in
// the app changes. Rules never navigate, never fetch, and never invent a
// number — if the context doesn't carry the data, the rule stays quiet and a
// lower priority speaks instead.
//
// BREADTH IS THE FEATURE. A coach who says the same thing every day stops
// being read. So the club-shaped rules below (crown, rivalry, standing,
// streak, loyalty, penalties, four milestone ladders) all sit in the same
// STATS band and are shuffled by the day, rather than stacked in a fixed
// order where the first one would always win. Within a day the choice is
// stable; across days the coach moves through everything it can honestly say.
//
// Text bodies carry NO greeting — the card prefixes "בוקר טוב, " itself — and
// put their emoji at the END so the sentence reads cleanly after the prefix.

import { he } from '@/i18n/he';
import {
  AssistantPriority,
  type AssistantContext,
  type AssistantMessage,
  type AssistantRule,
} from './types';
import { pickVariant } from './resolve';

const DAY_MS = 86_400_000;

/** Milestone ladders. A milestone only speaks when it's genuinely close. */
const GOAL_MILESTONES = [10, 20, 25, 50, 75, 100, 150, 200];
const ASSIST_MILESTONES = [10, 25, 50, 75, 100];
const GAMES_MILESTONES = [10, 25, 50, 100, 150, 200];
const WIN_MILESTONES = [10, 25, 50, 100, 200, 300];
/** "Close" = within this many of the next rung. Beyond it, it isn't news. */
const MILESTONE_WINDOW = 3;
/** Don't nag before this many days without a match. */
const COMEBACK_DAYS = 21;
/** How long a match stays "just now" for a contentless well-done. Beyond this
 *  the generic line is dropped in favour of something with actual substance. */
const POSTGAME_FRESH_MS = 10 * 60 * 60 * 1000;
/** A streak is only worth mentioning once it's actually a streak. */
const STREAK_MIN = 3;
/** Attendance-rate bragging needs a real sample behind it. */
const LOYALTY_MIN_NIGHTS = 10;
const ATTENDANCE_RATE_MIN = 80;
/** Career totals only speak once there's a number worth saying out loud. */
const CAREER_GOALS_MIN = 5;
const CAREER_ASSISTS_MIN = 3;
const CONTRIBUTION_MIN = 10;
const WINS_TOTAL_MIN = 5;
/** Account-shaped facts. */
const MONTH_MS = 30 * DAY_MS;
const TENURE_MIN_MONTHS = 3;
const FRIENDS_MIN = 3;
const CLUB_MEMBERS_MIN = 8;

/** Position code → the label the profile picker already shows. */
const POSITION_LABEL: Record<string, string> = {
  gk: he.positionGk,
  def: he.positionDef,
  mid: he.positionMid,
  att: he.positionAtt,
};

/** Next rung above `value`, and how far off it is — null when not close. */
function nextMilestone(
  value: number,
  ladder: readonly number[],
): { target: number; left: number } | null {
  if (value <= 0) return null;
  for (const target of ladder) {
    if (value < target) {
      const left = target - value;
      return left <= MILESTONE_WINDOW ? { target, left } : null;
    }
  }
  return null;
}

function msg(m: AssistantMessage): AssistantMessage {
  return m;
}

const statsCta = {
  label: he.assistantStatsCta,
  action: { kind: 'openStats' } as const,
};

// ── P0 · a real event waiting on the user ────────────────────────────────
// Intentionally EMPTY. Pending requests used to live here, but the bell at the
// top of the same screen already carries them with a count badge — saying it
// again in the coach's line was duplication in a different card. The band
// stays reserved for events with no other home on the screen.

// ── P1 · game day ────────────────────────────────────────────────────────
// The next-match card right below already carries kickoff time, pitch and
// sign-ups, so this line carries NONE of it. When there's a real stake on the
// line — a crown, a rival, a milestone, a streak to protect — that beats a
// generic cheer: same moment, more meaning. The stake variants rotate by day
// too, so two match days in a row don't read identically.
const gameDayRule: AssistantRule = (ctx) => {
  if (!ctx.isGameToday || !ctx.nextGame) return null;
  const club = ctx.clubName;
  const ins = ctx.clubInsight;

  const stakes: Array<() => string | null> = [
    // Within touching distance of the club's golden boot.
    () =>
      club && ins?.goalsToCrown && ins.goalsToCrown <= MILESTONE_WINDOW
        ? he.assistantGameDayCrown(ins.goalsToCrown, club)
        : null,
    // A round number on the lifetime tally.
    () => {
      const near = nextMilestone(ctx.user?.stats?.goals ?? 0, GOAL_MILESTONES);
      return near ? he.assistantGameDayGoalsMilestone(near.left, near.target) : null;
    },
    // The player one place up the scorer chart.
    () =>
      ins?.rivalName && ins.goalsToPassRival && ins.goalsToPassRival <= MILESTONE_WINDOW
        ? he.assistantGameDayRival(ins.rivalName, ins.goalsToPassRival)
        : null,
    // A run of attendances worth protecting.
    () =>
      club && ins && ins.attendanceStreak >= STREAK_MIN
        ? he.assistantGameDayStreak(ins.attendanceStreak, club)
        : null,
  ];
  const available = stakes.map((f) => f()).filter((t): t is string => !!t);
  if (available.length > 0) {
    return msg({
      id: 'gameDayStake',
      scenario: 'gameDayInsight',
      priority: AssistantPriority.GAME_DAY,
      text: pickVariant(available, 'gameDayStake', ctx.nonce),
    });
  }
  return msg({
    id: 'gameDay',
    scenario: 'gameDay',
    priority: AssistantPriority.GAME_DAY,
    text: pickVariant(he.assistantGameDay, 'gameDay', ctx.nonce),
  });
};

// ── P2 · just played ─────────────────────────────────────────────────────
// Within a day of a match. We deliberately quote no per-evening numbers: the
// only per-evening figures the client holds are the ones the evening-summary
// card owns, and guessing at "4 goals tonight" from lifetime totals would be
// exactly the invented statistic we refuse to print. The weekly count and the
// attendance streak ARE real, so those get to be specific.
const postGameRule: AssistantRule = (ctx) => {
  if (ctx.lastPlayedMs == null) return null;
  // A match TODAY that hasn't kicked off yet is game day, not an aftermath.
  if (ctx.isGameToday) return null;
  const sinceMs = ctx.now - ctx.lastPlayedMs;
  if (sinceMs > DAY_MS) return null;

  // A REAL fact about the match that just happened always wins. These two are
  // counted, not guessed: matches played since Sunday, and the run of
  // consecutive nights attended at the club.
  const concrete: string[] = [];
  if (ctx.playedThisWeek >= 2) {
    concrete.push(he.assistantPostGameWeek(ctx.playedThisWeek));
  }
  if (ctx.clubName && (ctx.clubInsight?.attendanceStreak ?? 0) >= STREAK_MIN) {
    concrete.push(
      he.assistantPostGameStreak(ctx.clubInsight!.attendanceStreak, ctx.clubName),
    );
  }
  if (concrete.length > 0) {
    return msg({
      id: 'postGameFact',
      scenario: 'postGame',
      priority: AssistantPriority.INSIGHT,
      text: pickVariant(concrete, 'postGameFact', ctx.nonce),
    });
  }

  // Nothing concrete to add. The generic pat on the back is only worth saying
  // while the match is still fresh — a full day later "איזה מחזור היה לך"
  // reads as if the app lost track of time. Outside that window we return
  // null and let the stats band speak instead, which will have something
  // genuinely useful to say ("two goals off the club's golden boot") rather
  // than a contentless cheer.
  if (sinceMs > POSTGAME_FRESH_MS) return null;
  return msg({
    id: 'postGame',
    scenario: 'postGame',
    priority: AssistantPriority.INSIGHT,
    text: pickVariant(he.assistantPostGame, 'postGame', ctx.nonce),
  });
};

// ── P3 · a concrete chance to play ───────────────────────────────────────
// Suppressed whenever the home screen is ALREADY showing the recommended day
// or the availability podium — both of those state the very same headcount,
// and saying it a third time is the duplication this feature exists to avoid.
const availabilityMatchRule: AssistantRule = (ctx) => {
  if (ctx.nextGame) return null; // they already have a match lined up
  if (ctx.shown.recommendedDay || ctx.shown.availabilityPodium) return null;
  const best = ctx.bestEvening;
  if (!best || best.count < 4) return null;
  return msg({
    id: 'availabilityMatch',
    scenario: 'availabilityMatch',
    priority: AssistantPriority.OPPORTUNITY,
    text: pickVariant(he.assistantAvailabilityMatch, 'availMatch', ctx.nonce),
    cta: {
      label: he.assistantAvailabilityMatchCta,
      action: { kind: 'createGame', dateMs: best.dateMs, window: 'evening' },
    },
  });
};

// ── P3 · been away a while ───────────────────────────────────────────────
// Framed as an invitation, never a telling-off, and only after three weeks so
// it can't fire on someone who simply skipped a week.
//
// Deliberately ranked ABOVE the club nudge: a player who's been off the pitch
// for three weeks is the person most likely to drift away for good, and
// "we've missed you" is a far better thing to say to them than the generic
// "nobody's booked anything". It still loses to a concrete chance to play,
// which is registered first in the same band.
const comebackRule: AssistantRule = (ctx) => {
  if (ctx.lastPlayedMs == null) return null; // never played → not a comeback
  if (ctx.nextGame) return null;
  const days = Math.floor((ctx.now - ctx.lastPlayedMs) / DAY_MS);
  if (days < COMEBACK_DAYS) return null;
  return msg({
    id: 'comeback',
    scenario: 'comeback',
    priority: AssistantPriority.OPPORTUNITY,
    text: pickVariant(he.assistantComeback, 'comeback', ctx.nonce),
    cta: { label: he.assistantComebackCta, action: { kind: 'browseGames' } },
  });
};

// ── P4 · the club has gone quiet ─────────────────────────────────────────
// "Quiet" has to mean quiet. A club with a match already scheduled (sign-ups
// not yet open) is not idle, and the "מחזור בדרך" card on the same screen
// would flatly contradict this line — so the rule stands down for it.
//
// PRIORITY DEPENDS ON WHO'S READING. For an admin this is a job they can do
// right now, so it outranks their personal stats. For a regular member it's a
// fact they can't act on much, and "two goals from the golden boot" is the
// better thing to hear — so for them the same line drops below the personal
// insights and only speaks when nothing sharper is available. Without this
// split the club line won every single day for every member and buried the
// entire stats band permanently.
const clubIdleRule: AssistantRule = (ctx) => {
  if (ctx.communities.length === 0) return null;
  if (ctx.nextGame) return null;
  if (ctx.shown.upcomingScheduledCard) return null;
  // A match that is open for sign-up is the loudest possible "not idle" — and
  // telling a member "nobody has booked anything" while places are filling
  // would be worse than saying nothing.
  if (ctx.shown.openToJoinCard) return null;
  // The admin gets the job, plainly — they're the one who can book a pitch.
  // A regular member can only wait, so for them this line alternates with the
  // coach's jokes: hearing "nobody's booked anything" every single day is how
  // a card stops being read.
  const pool = ctx.isClubAdmin
    ? he.assistantClubIdle
    : [...he.assistantClubIdle, ...he.assistantHumor];
  return msg({
    id: ctx.isClubAdmin ? 'clubIdleAdmin' : 'clubIdleMember',
    scenario: 'clubIdle',
    priority: ctx.isClubAdmin
      ? AssistantPriority.CLUB
      : AssistantPriority.DISCOVERY,
    text: pickVariant(pool, 'clubIdle', ctx.nonce),
    cta: {
      label: he.assistantClubIdleCta,
      action: { kind: 'createGame' },
    },
  });
};

// ── P5 · the personal / club-standing band ───────────────────────────────
//
// This is where the coach's variety lives. Every candidate below is a real,
// server-backed fact; we collect ALL of the ones that are currently true and
// then pick between them by the day. Ordering them by hand would mean the
// same fact every day for weeks — which is exactly the "same message all the
// time" problem this is meant to solve.
interface Candidate {
  id: string;
  scenario: AssistantMessage['scenario'];
  text: string;
}

function statsCandidates(ctx: AssistantContext): Candidate[] {
  const out: Candidate[] = [];
  const stats = ctx.user?.stats;
  const ins = ctx.clubInsight;
  const club = ctx.clubName;

  // ── club crowns ──
  if (club && ins) {
    if (ins.isTopScorer) {
      out.push({
        id: 'crownGoalsHeld',
        scenario: 'crown',
        text: he.assistantCrownGoalsHeld(ins.goals, club),
      });
    } else if (ins.goalsToCrown && ins.goalsToCrown <= 5) {
      out.push({
        id: 'crownGoalsChase',
        scenario: 'crown',
        text: he.assistantCrownGoalsChase(ins.goalsToCrown, club),
      });
    }
    if (ins.isTopAssister) {
      out.push({
        id: 'crownAssistsHeld',
        scenario: 'crown',
        text: he.assistantCrownAssistsHeld(ins.assists, club),
      });
    } else if (ins.assistsToCrown && ins.assistsToCrown <= 5) {
      out.push({
        id: 'crownAssistsChase',
        scenario: 'crown',
        text: he.assistantCrownAssistsChase(ins.assistsToCrown, club),
      });
    }

    // ── standing ──
    if (ins.rivalName && ins.goalsToPassRival && ins.goalsToPassRival <= 5) {
      out.push({
        id: 'rivalry',
        scenario: 'rivalry',
        text: he.assistantRivalry(ins.rivalName, ins.goalsToPassRival),
      });
    }
    // "One off the top 5" only means something in a table deep enough to have
    // a top 5 at all.
    if (ins.scorerPlace === 6 && ins.scorerTotal >= 8) {
      out.push({
        id: 'topFive',
        scenario: 'standing',
        text: he.assistantTopFive(club),
      });
    }
    if (ins.goals > 0 && ins.scorerTotal >= 5) {
      out.push({
        id: 'standing',
        scenario: 'standing',
        text: he.assistantStanding(ins.scorerPlace, ins.scorerTotal, club),
      });
    }
    if (ins.winsPlace && ins.winsPlace <= 3) {
      out.push({
        id: 'winsPlace',
        scenario: 'standing',
        text: he.assistantWinsPlace(ins.winsPlace, club),
      });
    }

    // ── attendance ──
    if (ins.attendanceStreak >= STREAK_MIN) {
      out.push({
        id: 'streak',
        scenario: 'streak',
        text: he.assistantStreak(ins.attendanceStreak, club),
      });
    }
    if (ins.attendedNights >= LOYALTY_MIN_NIGHTS) {
      out.push({
        id: 'loyaltyNights',
        scenario: 'loyalty',
        text: he.assistantLoyaltyNights(ins.attendedNights, club),
      });
    }
  }

  // ── attendance rate ──
  // Denominator is `playedCount` + cancellations, NOT `users.stats.totalGames`
  // — that field is written by nothing in production (the home screen's own
  // comment calls it dead), so keying on it meant this line could never fire,
  // and a stale legacy value could have produced "120% הגעה". Clamped anyway.
  const attended = ctx.playedCount ?? 0;
  const cancelled = stats?.cancelled ?? 0;
  const registered = attended + cancelled;
  if (attended >= LOYALTY_MIN_NIGHTS && registered > 0) {
    const pct = Math.min(100, Math.round((attended / registered) * 100));
    if (pct >= ATTENDANCE_RATE_MIN) {
      out.push({
        id: 'attendanceRate',
        scenario: 'loyalty',
        text: he.assistantAttendanceRate(pct),
      });
    }
  }

  // ── milestones on the four lifetime ladders ──
  const goals = nextMilestone(stats?.goals ?? 0, GOAL_MILESTONES);
  if (goals) {
    out.push({
      id: 'milestoneGoals',
      scenario: 'milestone',
      text: he.assistantMilestoneGoals(goals.left, goals.target),
    });
  }
  const assists = nextMilestone(stats?.assists ?? 0, ASSIST_MILESTONES);
  if (assists) {
    out.push({
      id: 'milestoneAssists',
      scenario: 'milestone',
      text: he.assistantMilestoneAssists(assists.left, assists.target),
    });
  }
  const games = nextMilestone(ctx.playedCount ?? 0, GAMES_MILESTONES);
  if (games) {
    out.push({
      id: 'milestoneGames',
      scenario: 'milestone',
      text: he.assistantMilestoneGames(games.left, games.target),
    });
  }
  const wins = nextMilestone(stats?.wins ?? 0, WIN_MILESTONES);
  if (wins) {
    out.push({
      id: 'milestoneWins',
      scenario: 'milestone',
      text: he.assistantMilestoneWins(wins.left, wins.target),
    });
  }

  // ── shootout record ──
  const taken = stats?.penTaken ?? 0;
  const scoredPens = stats?.penScored ?? 0;
  if (taken >= 3 && scoredPens / taken >= 0.6) {
    out.push({
      id: 'penKicker',
      scenario: 'penalties',
      text: he.assistantPenKicker(scoredPens, taken),
    });
  }
  const saved = stats?.penSaved ?? 0;
  if (saved >= 1) {
    out.push({
      id: 'penKeeper',
      scenario: 'penalties',
      text: he.assistantPenKeeper(saved),
    });
  }

  // ── soft personal facts ──
  // Neutral, not a nudge: "12 days since your last match" is a fact about you,
  // where the comeback line (3 weeks, with a CTA) is an invitation. Capped
  // below that threshold so the two never say the same thing twice.
  if (ctx.lastPlayedMs != null) {
    const days = Math.floor((ctx.now - ctx.lastPlayedMs) / DAY_MS);
    if (days >= 7 && days < COMEBACK_DAYS) {
      out.push({
        id: 'daysSincePlayed',
        scenario: 'loyalty',
        text: he.assistantDaysSincePlayed(days),
      });
    }
  }
  if (ctx.playedThisWeek >= 2) {
    out.push({
      id: 'weekCount',
      scenario: 'loyalty',
      text: he.assistantWeekCount(ctx.playedThisWeek),
    });
  }
  if ((ctx.playedCount ?? 0) >= LOYALTY_MIN_NIGHTS) {
    out.push({
      id: 'totalGames',
      scenario: 'loyalty',
      text: he.assistantTotalGames(ctx.playedCount as number),
    });
  }

  // ── career totals ──
  // Deliberately separate from the milestone ladders above: a milestone only
  // speaks within 3 of the next rung, so a player sitting on 34 goals would
  // otherwise never hear his own number.
  const careerGoals = stats?.goals ?? 0;
  const careerAssists = stats?.assists ?? 0;
  const played = ctx.playedCount ?? 0;
  if (careerGoals >= CAREER_GOALS_MIN) {
    out.push({
      id: 'careerGoals',
      scenario: 'career',
      text: he.assistantCareerGoals(careerGoals),
    });
  }
  if (careerAssists >= CAREER_ASSISTS_MIN) {
    out.push({
      id: 'careerAssists',
      scenario: 'career',
      text: he.assistantCareerAssists(careerAssists),
    });
  }
  if (careerGoals + careerAssists >= CONTRIBUTION_MIN) {
    out.push({
      id: 'contribution',
      scenario: 'career',
      text: he.assistantContribution(careerGoals + careerAssists),
    });
  }
  // A per-match average needs BOTH a real sample of matches and enough goals
  // for the ratio to mean anything — "0.1 goals a match" is not a compliment.
  if (played >= LOYALTY_MIN_NIGHTS && careerGoals >= CAREER_GOALS_MIN) {
    const avg = (careerGoals / played).toFixed(1);
    out.push({
      id: 'goalsPerGame',
      scenario: 'career',
      text: he.assistantGoalsPerGame(avg, played),
    });
  }
  if ((stats?.wins ?? 0) >= WINS_TOTAL_MIN) {
    out.push({
      id: 'winsTotal',
      scenario: 'standing',
      text: he.assistantWinsTotal(stats!.wins as number),
    });
  }
  // Own goals are a real stat with its own club title (מלך השערים העצמיים),
  // so the coach owns it out loud — as a joke, which is the only tone that
  // works for a number nobody is proud of.
  if ((stats?.ownGoals ?? 0) >= 1) {
    out.push({
      id: 'ownGoals',
      scenario: 'humor',
      text: he.assistantOwnGoals(stats!.ownGoals as number),
    });
  }
  const faced = stats?.penFaced ?? 0;
  if (faced >= 3) {
    out.push({
      id: 'penKeeperRate',
      scenario: 'penalties',
      text: he.assistantPenKeeperRate(stats?.penSaved ?? 0, faced),
    });
  }
  // Never cancelled, with enough registrations for that to be a record rather
  // than a coincidence.
  if (played >= LOYALTY_MIN_NIGHTS && (stats?.cancelled ?? 0) === 0) {
    out.push({
      id: 'noCancels',
      scenario: 'loyalty',
      text: he.assistantNoCancels(played),
    });
  }

  // ── who you are on Teamder ──
  // Not match stats, but true facts about this account, and they give the
  // coach something to say to a player whose goal column is still empty.
  const created = ctx.user?.createdAt ?? 0;
  if (created > 0) {
    const months = Math.floor((ctx.now - created) / MONTH_MS);
    if (months >= TENURE_MIN_MONTHS) {
      out.push({
        id: 'tenure',
        scenario: 'loyalty',
        text: he.assistantTenure(months),
      });
    }
  }
  const friends = ctx.user?.friends?.length ?? 0;
  if (friends >= FRIENDS_MIN) {
    out.push({
      id: 'friendsCount',
      scenario: 'engagement',
      text: he.assistantFriendsCount(friends),
    });
  }
  if (ctx.communities.length >= 2) {
    out.push({
      id: 'clubsCount',
      scenario: 'engagement',
      text: he.assistantClubsCount(ctx.communities.length),
    });
  }
  const mainClub = ctx.communities[0];
  if (club && mainClub && mainClub.playerIds.length >= CLUB_MEMBERS_MIN) {
    out.push({
      id: 'clubMembers',
      scenario: 'engagement',
      text: he.assistantClubMembers(mainClub.playerIds.length, club),
    });
  }
  const position = ctx.user?.position;
  if (position) {
    out.push({
      id: 'position',
      scenario: 'engagement',
      text: he.assistantPositionLine(POSITION_LABEL[position]),
    });
  }

  // ── the coach's jokes, drawn from the SAME pool ──
  // The owner's ask: mix them in rather than keeping humour as a last resort.
  // A player with plenty of stats still gets the occasional "put the pizza
  // down", which is what stops the card reading like a dashboard.
  //
  // Only ALONGSIDE facts, though. With nothing countable this band must stay
  // silent so the lower-priority rules (quiet club, join a club, mark your
  // availability) still get their turn — those pools carry the same jokes, so
  // a player with no numbers loses no humour, only the actionable line they'd
  // otherwise never see.
  if (out.length > 0) {
    for (const [i, joke] of he.assistantHumor.entries()) {
      out.push({ id: `humor${i}`, scenario: 'humor', text: joke });
    }
    // Same gate, but the line knows what day it is — Thursday and Tuesday
    // shouldn't get identical small talk.
    const day = new Date(ctx.now).getDay();
    const flavour =
      day === 4 || day === 5 || day === 6
        ? he.assistantWeekendFlavor
        : he.assistantMidweekFlavor;
    for (const [i, line] of flavour.entries()) {
      out.push({ id: `flavour${i}`, scenario: 'humor', text: line });
    }
  }

  return out;
}

const statsRule: AssistantRule = (ctx) => {
  const candidates = statsCandidates(ctx);
  if (candidates.length === 0) return null;
  const chosen = pickVariant(candidates, 'statsBand', ctx.nonce);
  return msg({
    id: chosen.id,
    scenario: chosen.scenario,
    priority: AssistantPriority.STATS,
    text: chosen.text,
    cta: statsCta,
  });
};

// ── P6 · discovery ───────────────────────────────────────────────────────
const joinClubRule: AssistantRule = (ctx) => {
  if (ctx.communities.length > 0) return null;
  return msg({
    id: 'joinClub',
    scenario: 'joinClub',
    priority: AssistantPriority.DISCOVERY,
    text: pickVariant(he.assistantJoinClub, 'joinClub', ctx.nonce),
    sub: he.assistantJoinClubSub,
    cta: {
      label: he.assistantJoinClubCta,
      action: { kind: 'discoverClubs' },
    },
  });
};

// The home screen already shows a full-width "set your availability" prompt to
// a player who hasn't marked any — saying it again here would be the second
// ask on one screen.
const markAvailabilityRule: AssistantRule = (ctx) => {
  if (ctx.markedAvailability) return null;
  if (ctx.nextGame) return null;
  if (ctx.shown.availabilityPrompt) return null;
  return msg({
    id: 'markAvailability',
    scenario: 'markAvailability',
    priority: AssistantPriority.DISCOVERY,
    text: pickVariant(he.assistantMarkAvailability, 'markAvail', ctx.nonce),
    sub: he.assistantMarkAvailabilitySub,
    cta: {
      label: he.assistantMarkAvailabilityCta,
      action: { kind: 'markAvailability' },
    },
  });
};

// ── P7 · always something to say ─────────────────────────────────────────
// The floor, and the least informative rule by definition — it fires exactly
// when there is no fact to report. So it leans on the jokes: a player with
// nothing countable gets a nudge with a smile rather than a hollow "time to
// play" repeated forever. No numbers, no claims, just an open door.
// Only skipped when the user already has a match lined up, in which case the
// game-day/next-match surfaces have it covered and silence is better.
const engagementRule: AssistantRule = (ctx) => {
  if (ctx.nextGame) return null;
  return msg({
    id: 'engagement',
    scenario: 'engagement',
    priority: AssistantPriority.ENGAGEMENT,
    text: pickVariant(
      [...he.assistantEngagement, ...he.assistantHumor],
      'engagement',
      ctx.now,
    ),
    cta: { label: he.assistantEngagementCta, action: { kind: 'browseGames' } },
  });
};

/** Registration order = the tie-break among equal priorities. */
export const ASSISTANT_RULES: readonly AssistantRule[] = [
  gameDayRule,
  postGameRule,
  availabilityMatchRule,
  comebackRule,
  clubIdleRule,
  statsRule,
  joinClubRule,
  markAvailabilityRule,
  engagementRule,
];
