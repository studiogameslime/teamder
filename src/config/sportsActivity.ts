import config from './sportsActivity.json';

// Temporary release suspension requested by the owner on 27.10.2026.
export const SPORTS_ACTIVITY_ENABLED: boolean = config.enabled;
export class SportsActivityDisabledError extends Error {
  constructor() { super('Sports activity is temporarily disabled'); this.name = 'SportsActivityDisabledError'; }
}
export function assertSportsActivityEnabled(): void {
  if (!SPORTS_ACTIVITY_ENABLED) throw new SportsActivityDisabledError();
}
