/** Detailed history is independent of the small set of founder push milestones. */
export function onboardingPushMilestone(action: string, params: Record<string, unknown> = {}): string | null {
  if (action === 'entry_source_resolved' && typeof params.is_guest === 'boolean') return 'entry';
  if (action === 'auth_prompt_shown') return 'registration_started';
  if (action === 'auth_completed' || (action === 'sign_in_success' && params.method !== 'guest')) return 'authenticated';
  if (action === 'entry_intent_selected' && params.is_guest === true
    && ['create_club', 'find_game', 'one_off_game', 'invite'].includes(String(params.intent))) {
    return `intent:${params.intent}`;
  }
  // Registration, club/game creation and availability already have their own alerts.
  return null;
}
