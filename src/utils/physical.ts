// Pure physical / heatmap math — no RN/native imports, fully unit-testable.
//
//   • normalizeToPitch — a GPS point + the 4 calibrated pitch corners → a
//                        0..1 (x,y) on the pitch, or null if off-pitch (bench).
//   • routeToHeatGrid  — normalized points → a row-major heat grid (0..1).
//   • computeHrZones   — a heart-rate series → minutes in each zone.
//   • computeEffort    — avg/max HR + active minutes → a 0..100 effort score.
//
// The affine mapping treats the pitch as a (possibly rotated) parallelogram:
// corner0 = one baseline corner, corner1 across the width, corner3 down the
// length. Perspective is ignored — negligible for a flat pitch at phone/watch
// range, and the heatmap is blurred anyway.

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Map a GPS point into pitch-local (x,y) in [0,1]. `corners` is [TL, TR, BR, BL]
 * (any consistent winding works as long as TL→TR is the width axis and TL→BL is
 * the length axis). Returns null when the solve is degenerate or the point
 * falls outside the pitch (with a small tolerance) — i.e. the sideline/bench.
 */
export function normalizeToPitch(
  point: LatLng,
  corners: LatLng[],
  tolerance = 0.06,
): { x: number; y: number } | null {
  if (!point || !corners || corners.length < 4) return null;
  const [tl, tr, , bl] = corners;
  if (!tl || !tr || !bl) return null;
  // u = width axis, v = length axis, in raw lat/lng space.
  const ux = tr.lng - tl.lng;
  const uy = tr.lat - tl.lat;
  const vx = bl.lng - tl.lng;
  const vy = bl.lat - tl.lat;
  const det = ux * vy - uy * vx;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const px = point.lng - tl.lng;
  const py = point.lat - tl.lat;
  // Solve [u v] [x y]^T = p  (2x2 inverse).
  const x = (px * vy - py * vx) / det;
  const y = (ux * py - uy * px) / det;
  if (
    x < -tolerance ||
    x > 1 + tolerance ||
    y < -tolerance ||
    y > 1 + tolerance
  ) {
    return null; // off-pitch → dropped (the bench-time fix)
  }
  return { x: clamp01(x), y: clamp01(y) };
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Reorder 4 GPS corners (marked in ANY order/direction) into the canonical
 * winding normalizeToPitch expects: consecutive corners adjacent, index0↔index2
 * diagonal, AND corner0→corner3 is the LONG (length) axis so the heatmap rows
 * always map to pitch length — never transposed. Without this, half of natural
 * perimeter walks (clockwise vs counter-clockwise) would rotate/transpose the
 * map and make the attack/middle/defense split meaningless. Returns null for
 * bad input. (Which short END is "attack" is inherently unknowable from GPS and
 * is left arbitrary-but-consistent per pitch.)
 */
export function canonicalizeCorners(corners: LatLng[]): LatLng[] | null {
  if (!corners || corners.length !== 4) return null;
  if (corners.some((c) => !c || !Number.isFinite(c.lat) || !Number.isFinite(c.lng))) {
    return null;
  }
  const cx = corners.reduce((s, c) => s + c.lng, 0) / 4;
  const cy = corners.reduce((s, c) => s + c.lat, 0) / 4;
  // Order by angle around the centroid → a consistent convex winding where
  // consecutive corners are adjacent and [0]↔[2] / [1]↔[3] are the diagonals.
  const ordered = [...corners].sort(
    (a, b) => Math.atan2(a.lat - cy, a.lng - cx) - Math.atan2(b.lat - cy, b.lng - cx),
  );
  const sq = (p: LatLng, q: LatLng) => {
    const dx = p.lng - q.lng;
    const dy = p.lat - q.lat;
    return dx * dx + dy * dy;
  };
  // Ensure the long edge sits on corner0→corner3 (the length/rows axis). If the
  // long edge is currently 0→1, rotate the winding by one.
  if (sq(ordered[0], ordered[1]) > sq(ordered[0], ordered[3])) {
    return [ordered[1], ordered[2], ordered[3], ordered[0]];
  }
  return ordered;
}

/**
 * Bin normalized (x,y) points into a row-major grid and normalize to a 0..1
 * intensity (peak cell = 1). A light 3×3 box blur softens it so the render
 * reads as a heat cloud, not sparse dots. `y` maps to rows, `x` to cols.
 */
export function routeToHeatGrid(
  points: Array<{ x: number; y: number }>,
  rows = 6,
  cols = 4,
): number[] {
  const grid = new Array(rows * cols).fill(0);
  if (!points || !points.length || rows <= 0 || cols <= 0) return grid;
  for (const p of points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const r = Math.min(rows - 1, Math.max(0, Math.floor(clamp01(p.y) * rows)));
    const c = Math.min(cols - 1, Math.max(0, Math.floor(clamp01(p.x) * cols)));
    grid[r * cols + c] += 1;
  }
  // 3×3 box blur.
  const blurred = new Array(rows * cols).fill(0);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let sum = 0;
      let cnt = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
          sum += grid[rr * cols + cc];
          cnt += 1;
        }
      }
      blurred[r * cols + c] = cnt ? sum / cnt : 0;
    }
  }
  const max = Math.max(...blurred, 0);
  if (max <= 0) return grid.map(() => 0);
  return blurred.map((v) => Math.round((v / max) * 100) / 100);
}

export interface HrZoneMinutes {
  light: number;
  moderate: number;
  intense: number;
  peak: number;
}

/**
 * Split a heart-rate series into minutes per zone, using %HRmax bands:
 *   light < 60%, moderate 60–75%, intense 75–88%, peak ≥ 88%.
 * `samples` are {bpm, ms} timestamps; the gap to the NEXT sample is the time
 * attributed to the current bpm (capped so a pause doesn't dump huge time).
 */
export function computeHrZones(
  samples: Array<{ bpm: number; ms: number }>,
  maxHr: number,
  maxGapMs = 30_000,
): HrZoneMinutes {
  const z: HrZoneMinutes = { light: 0, moderate: 0, intense: 0, peak: 0 };
  if (!samples || samples.length < 2 || !maxHr || maxHr <= 0) return z;
  const ordered = [...samples].sort((a, b) => a.ms - b.ms);
  for (let i = 0; i < ordered.length - 1; i++) {
    const s = ordered[i];
    if (!Number.isFinite(s.bpm)) continue;
    const dtMs = Math.min(maxGapMs, Math.max(0, ordered[i + 1].ms - s.ms));
    const mins = dtMs / 60_000;
    const pct = s.bpm / maxHr;
    if (pct < 0.6) z.light += mins;
    else if (pct < 0.75) z.moderate += mins;
    else if (pct < 0.88) z.intense += mins;
    else z.peak += mins;
  }
  // Returned UNROUNDED on purpose: computeEffort consumes these directly, and
  // rounding here would zero out sub-30-second zones from the effort score.
  // Rounding to whole minutes happens only at the display/storage layer.
  return z;
}

/**
 * A 0..100 effort score from average HR (relative to max) plus the share of
 * time spent in the two hardest zones. Objective, position-neutral — a grinder
 * who never scored can still top it.
 */
export function computeEffort(
  avgHr: number,
  maxHr: number,
  zones: HrZoneMinutes,
): number {
  if (!maxHr || maxHr <= 0) return 0;
  const avgPct = Math.max(0, Math.min(1, (avgHr || 0) / maxHr));
  const total = zones.light + zones.moderate + zones.intense + zones.peak;
  const hardShare = total > 0 ? (zones.intense + zones.peak) / total : 0;
  // 70% weight on sustained avg HR, 30% on time in the red.
  const raw = avgPct * 0.7 + hardShare * 0.3;
  return Math.round(Math.max(0, Math.min(1, raw)) * 100);
}
