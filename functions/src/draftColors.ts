/** Preserve the manager's pre-allocation palette in scheduled generation too. */
export function applyScheduledColors<T extends {index: number; colorKey?: string}>(teams: T[], value: unknown): T[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return teams;
  const palette = ['red','blue','green','yellow','orange','purple','black','white'];
  const choices = value as Record<number, unknown>, selected = new Map<number,string>(), used = new Set<string>();
  for (const team of teams) {
    const key = choices[team.index];
    if (typeof key === 'string' && palette.includes(key) && !used.has(key)) {selected.set(team.index,key); used.add(key);}
  }
  return teams.map(team => {
    const preferred = palette[team.index];
    const key = selected.get(team.index) ?? (preferred && !used.has(preferred) ? preferred : palette.find(c => !used.has(c))!);
    used.add(key); return {...team, colorKey:key};
  });
}
