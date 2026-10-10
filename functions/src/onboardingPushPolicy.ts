/** Detailed history is independent of the small set of founder push milestones. */
export function onboardingPushMilestone(action: string, params: Record<string, unknown> = {}): string | null {
  if (action === 'entry_source_resolved' && params.is_guest === true) return 'entry';
  if (action === 'entry_intent_selected' && params.is_guest === true
    && ['create_club', 'find_game', 'one_off_game', 'invite'].includes(String(params.intent))) {
    return `intent:${params.intent}`;
  }
  // Registration, club/game creation and availability already have their own alerts.
  return null;
}
