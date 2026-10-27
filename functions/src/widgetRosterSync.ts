import { observeCaughtError } from './serverErrorLog';

type GameData = Record<string, unknown>;
type PushUser = { uid?: string; platform?: string; fcmTokens?: string[] };
type Dependencies = {
  loadUsers: (ids: string[]) => Promise<PushUser[]>;
  send: (message: { tokens: string[]; data: Record<string, string>;
    android: { priority: 'normal'; ttl: number } }) => Promise<unknown>;
};

function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && !!id) : [];
}

function recipients(game: GameData | undefined): string[] {
  if (!game) return [];
  return [...ids(game.participantIds), ...ids(game.players), ...ids(game.waitlist), ...ids(game.pending),
    ...(typeof game.createdBy === 'string' && game.createdBy ? [game.createdBy] : [])];
}

/** Only visible roster/metadata and audience changes; timer ticks are separate. */
function rosterFingerprint(game: GameData | undefined): string {
  if (!game) return 'missing';
  const guests = Array.isArray(game.guests) ? game.guests.map(value => {
    const guest = (value ?? {}) as GameData;
    return [guest.id ?? '', guest.name ?? '', guest.waitlisted === true];
  }) : [];
  return JSON.stringify([ids(game.players), guests, [...new Set(recipients(game))].sort(),
    game.title ?? '', game.status ?? '', game.startsAt ?? 0, game.maxPlayers ?? 0,
    game.fieldName ?? '', game.city ?? '', game.registrationOpensAt ?? 0,
    (game.liveMatch as GameData | undefined)?.phase ?? '',
    (game.liveMatch as GameData | undefined)?.assignments ?? null,
    (game.rotation as GameData | undefined)?.playing ?? null,
    (game.rotation as GameData | undefined)?.loans ?? null,
    game.draftTeams ?? null]);
}

/** An invalidation, never an FCM-sized copy of a potentially large roster.
 * Include former members so their displayed roster can be cleared too. */
export async function sendWidgetRosterInvalidation(
  gameId: string, before: GameData | undefined, after: GameData | undefined, dependencies: Dependencies,
): Promise<void> {
  if (rosterFingerprint(before) === rosterFingerprint(after)) return;
  const audience = [...new Set([...recipients(before), ...recipients(after)])];
  if (!audience.length) return;
  const users = await dependencies.loadUsers(audience);
  for (const user of users) {
    if (user.platform !== 'android' || !user.uid || !audience.includes(user.uid)) continue;
    const tokens = [...new Set(ids(user.fcmTokens))];
    for (let start = 0; start < tokens.length; start += 500) {
      try {
        await dependencies.send({ tokens: tokens.slice(start, start + 500),
          data: { type: 'widgetRosterSync', gameId, viewerId: user.uid },
          android: { priority: 'normal', ttl: 24 * 60 * 60 * 1000 } });
      } catch (error) {
        observeCaughtError(error, { source: 'functions/src/widgetRosterSync.ts',
          handler: 'sendWidgetRosterInvalidation', site: 'widgetRosterSync:send' });
        // Let the trigger report the delivery failure instead of claiming success.
        throw error;
      }
    }
  }
}
