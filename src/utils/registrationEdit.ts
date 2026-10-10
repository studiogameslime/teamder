/** Edit only the registration gate, never the roster or the notification latch. */
export function registrationEditPatch(status: string, enabled: boolean, opensAt: number, now: number) {
  if (status !== 'open' && status !== 'scheduled') return {};
  return { registrationOpensAt: enabled && opensAt > 0 ? opensAt : status === 'scheduled' ? now : 0 };
}

export function registrationEditStatus(status: string, opensAt: number, now: number): 'scheduled' | undefined {
  return status === 'open' && opensAt > now ? 'scheduled' : undefined;
}
