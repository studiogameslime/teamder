import {
  normalizeToPitch,
  routeToHeatGrid,
  computeHrZones,
  computeEffort,
  canonicalizeCorners,
  type LatLng,
} from '@/utils/physical';

// A unit square pitch: TL(0,0) TR(0,1) BR(1,1) BL(1,0) in {lat,lng}.
const CORNERS: LatLng[] = [
  { lat: 0, lng: 0 },
  { lat: 0, lng: 1 },
  { lat: 1, lng: 1 },
  { lat: 1, lng: 0 },
];

describe('normalizeToPitch', () => {
  it('maps the centre to (0.5, 0.5)', () => {
    const r = normalizeToPitch({ lat: 0.5, lng: 0.5 }, CORNERS);
    expect(r).not.toBeNull();
    expect(r!.x).toBeCloseTo(0.5, 5);
    expect(r!.y).toBeCloseTo(0.5, 5);
  });
  it('drops an off-pitch (bench) point', () => {
    expect(normalizeToPitch({ lat: 2, lng: 0.5 }, CORNERS)).toBeNull();
  });
  it('keeps a point just inside the tolerance band', () => {
    expect(normalizeToPitch({ lat: -0.03, lng: 0.5 }, CORNERS)).not.toBeNull();
  });
  it('returns null for degenerate / missing corners', () => {
    expect(normalizeToPitch({ lat: 0, lng: 0 }, [])).toBeNull();
  });
});

describe('canonicalizeCorners', () => {
  // A pitch longer along lat (0.002) than wide along lng (0.001).
  const A = { lat: 0, lng: 0 };
  const B = { lat: 0, lng: 0.001 };
  const C = { lat: 0.002, lng: 0.001 };
  const D = { lat: 0.002, lng: 0 };
  const sq = (p: LatLng, q: LatLng) => (p.lng - q.lng) ** 2 + (p.lat - q.lat) ** 2;

  const orderings: LatLng[][] = [
    [A, B, C, D], // clockwise from A
    [A, D, C, B], // counter-clockwise from A
    [C, D, A, B], // shifted start
    [B, C, D, A], // another start
  ];

  it('always puts the LONG axis on corner0→corner3, regardless of marking order', () => {
    for (const o of orderings) {
      const c = canonicalizeCorners(o)!;
      expect(c).not.toBeNull();
      // corner0→corner3 (length/rows) must be the long edge; 0→1 the short.
      expect(sq(c[0], c[3])).toBeGreaterThan(sq(c[0], c[1]));
      // corner0↔corner2 must be the diagonal (longer than either edge).
      expect(sq(c[0], c[2])).toBeGreaterThan(sq(c[0], c[3]));
    }
  });

  it('returns a permutation of the same 4 points', () => {
    const c = canonicalizeCorners([C, A, D, B])!;
    const key = (p: LatLng) => `${p.lat},${p.lng}`;
    expect(new Set(c.map(key))).toEqual(new Set([A, B, C, D].map(key)));
  });

  it('null for bad input', () => {
    expect(canonicalizeCorners([A, B, C])).toBeNull();
    expect(canonicalizeCorners([A, B, C, { lat: NaN, lng: 0 }])).toBeNull();
  });
});

describe('routeToHeatGrid', () => {
  it('concentrates heat where the player stood and peaks at 1', () => {
    const pts = Array.from({ length: 50 }, () => ({ x: 0.1, y: 0.1 }));
    const grid = routeToHeatGrid(pts, 6, 4);
    expect(grid).toHaveLength(24);
    expect(Math.max(...grid)).toBe(1);
    expect(grid[0]).toBe(1); // top-left cell is the hottest
  });
  it('is all-zero for no points', () => {
    expect(routeToHeatGrid([], 6, 4).every((v) => v === 0)).toBe(true);
  });
});

describe('computeHrZones', () => {
  it('attributes more time to peak for a high-HR series', () => {
    const samples = [
      { bpm: 190, ms: 0 },
      { bpm: 190, ms: 30_000 },
      { bpm: 190, ms: 60_000 },
      { bpm: 190, ms: 90_000 },
    ];
    const z = computeHrZones(samples, 200);
    expect(z.peak).toBeGreaterThan(0);
    expect(z.light).toBe(0);
  });
  it('is empty for too few samples or no maxHr', () => {
    expect(computeHrZones([{ bpm: 100, ms: 0 }], 200)).toEqual({
      light: 0,
      moderate: 0,
      intense: 0,
      peak: 0,
    });
    expect(computeHrZones([{ bpm: 100, ms: 0 }, { bpm: 100, ms: 1000 }], 0).peak).toBe(0);
  });
});

describe('computeEffort', () => {
  it('is 0 with no heart-rate data', () => {
    expect(computeEffort(0, 200, { light: 0, moderate: 0, intense: 0, peak: 0 })).toBe(0);
    expect(computeEffort(150, 0, { light: 0, moderate: 0, intense: 0, peak: 0 })).toBe(0);
  });
  it('rises with sustained high HR + time in the red', () => {
    const hard = computeEffort(185, 200, { light: 0, moderate: 5, intense: 10, peak: 10 });
    const easy = computeEffort(110, 200, { light: 20, moderate: 3, intense: 0, peak: 0 });
    expect(hard).toBeGreaterThan(easy);
    expect(hard).toBeLessThanOrEqual(100);
    expect(easy).toBeGreaterThanOrEqual(0);
  });
});
