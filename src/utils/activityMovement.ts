/** Speed is m/s. Durations are estimates only between nearby samples in one series.
 * Missing, conflicting or sparse data is never labelled rest. */
export interface MovementSample { at: number; mps: number; series: string }
export interface ActivityMovement {
  maxSpeedKmh: number | null; avgSpeedKmh: number | null;
  stationaryMs: number | null; walkingMs: number | null; runningMs: number | null;
  sprintMs: number | null; sprints: number | null; sampledMs: number | null;
}
export function activityMovement(samples: MovementSample[]): ActivityMovement {
  const result: ActivityMovement = { maxSpeedKmh: null, avgSpeedKmh: null, stationaryMs: null,
    walkingMs: null, runningMs: null, sprintMs: null, sprints: null, sampledMs: null };
  const groups = new Map<string, Map<number, number>>();
  let conflict = false;
  for (const s of samples) {
    if (!Number.isSafeInteger(s.at) || s.at < 0) continue;
    const group = groups.get(s.series) ?? new Map<number, number>();
    if (group.has(s.at) && group.get(s.at) !== s.mps) conflict = true;
    group.set(s.at, s.mps); groups.set(s.series, group);
  }
  const valid = (v: number) => Number.isFinite(v) && v >= 0 && v <= 12;
  const unique = new Map<number, number>();
  const intervals: Array<{ from: number; to: number; speed: number; series: string }> = [];
  for (const [series, group] of groups) {
    const rows = [...group].sort((a, b) => a[0] - b[0]);
    rows.forEach(([at, speed], i) => {
      if (!valid(speed)) return;
      if (unique.has(at) && unique.get(at) !== speed) conflict = true;
      unique.set(at, speed);
      const next = rows[i + 1];
      if (next && valid(next[1]) && next[0] - at <= 15000)
        intervals.push({ from: at, to: next[0], speed, series });
    });
  }
  if (conflict) return result;
  const speeds = [...unique.values()];
  if (speeds.length) {
    result.maxSpeedKmh = speeds.reduce((max, v) => Math.max(max, v), 0) * 3.6;
    result.avgSpeedKmh = speeds.reduce((sum, v) => sum + v, 0) / speeds.length * 3.6;
  }
  if (!intervals.length) return result;
  intervals.sort((a, b) => a.from - b.from || a.to - b.to);
  // Exact duplicate intervals from the same writer are counted once; other overlaps are ambiguous.
  const rows = intervals.filter((v, i) => !i || v.from !== intervals[i - 1].from || v.to !== intervals[i - 1].to || v.speed !== intervals[i - 1].speed);
  if (rows.some((r, i) => i > 0 && r.from < rows[i - 1].to)) return result;
  result.stationaryMs = result.walkingMs = result.runningMs = result.sprintMs = result.sprints = result.sampledMs = 0;
  let sprintDuration = 0, lastEnd = -1, lastSeries = '';
  const finishSprint = () => { if (sprintDuration >= 2000) result.sprints!++; sprintDuration = 0; };
  for (const r of rows) {
    if (r.from !== lastEnd || r.series !== lastSeries) finishSprint();
    const ms = r.to - r.from, kmh = r.speed * 3.6;
    result.sampledMs += ms;
    if (kmh < 1) result.stationaryMs += ms;
    else if (kmh < 7) result.walkingMs += ms;
    else result.runningMs += ms;
    if (kmh >= 19) { result.sprintMs += ms; sprintDuration += ms; } else finishSprint();
    lastEnd = r.to; lastSeries = r.series;
  }
  finishSprint();
  return result;
}
