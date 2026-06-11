import { skyForHour, weatherKind } from '@/utils/heroAtmosphere';

describe('skyForHour', () => {
  it('morning band 5–9 → morning, no floodlights', () => {
    for (let h = 5; h <= 9; h++) {
      expect(skyForHour(h).mode).toBe('morning');
      expect(skyForHour(h).floodlights).toBe(false);
    }
  });
  it('day band 10–15 → day, no floodlights', () => {
    for (let h = 10; h <= 15; h++) {
      expect(skyForHour(h).mode).toBe('day');
      expect(skyForHour(h).floodlights).toBe(false);
    }
  });
  it('sunset band 16–18 → sunset, no floodlights', () => {
    for (let h = 16; h <= 18; h++) {
      expect(skyForHour(h).mode).toBe('sunset');
      expect(skyForHour(h).floodlights).toBe(false);
    }
  });
  it('night band 19–23 and 0–4 → night, floodlights on', () => {
    for (const h of [19, 20, 21, 22, 23, 0, 1, 2, 3, 4]) {
      expect(skyForHour(h).mode).toBe('night');
      expect(skyForHour(h).floodlights).toBe(true);
    }
  });
  it('always returns a 3-stop gradient', () => {
    for (let h = 0; h < 24; h++) {
      expect(skyForHour(h).gradient).toHaveLength(3);
      skyForHour(h).gradient.forEach((c) => expect(typeof c).toBe('string'));
    }
  });
});

describe('weatherKind', () => {
  it('clear', () => {
    expect(weatherKind(0)).toBe('clear');
    expect(weatherKind(1)).toBe('clear');
  });
  it('clouds', () => {
    expect(weatherKind(2)).toBe('clouds');
    expect(weatherKind(3)).toBe('clouds');
  });
  it('fog', () => {
    expect(weatherKind(45)).toBe('fog');
    expect(weatherKind(48)).toBe('fog');
  });
  it('rain (drizzle + rain + showers)', () => {
    for (const c of [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82]) {
      expect(weatherKind(c)).toBe('rain');
    }
  });
  it('snow', () => {
    for (const c of [71, 73, 75, 77, 85, 86]) {
      expect(weatherKind(c)).toBe('snow');
    }
  });
  it('storm', () => {
    for (const c of [95, 96, 99]) expect(weatherKind(c)).toBe('storm');
  });
  it('unknown for undefined / unmapped', () => {
    expect(weatherKind(undefined)).toBe('unknown');
    expect(weatherKind(4)).toBe('unknown');
    expect(weatherKind(49)).toBe('unknown');
  });
});
