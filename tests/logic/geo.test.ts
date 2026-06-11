import { haversineKm, formatKm } from '@/utils/geo';

const TLV = { lat: 32.0853, lng: 34.7818 };
const JLM = { lat: 31.7683, lng: 35.2137 };

describe('haversineKm', () => {
  it('returns Infinity for null / undefined inputs', () => {
    expect(haversineKm(null, TLV)).toBe(Infinity);
    expect(haversineKm(TLV, null)).toBe(Infinity);
    expect(haversineKm(undefined, undefined)).toBe(Infinity);
  });
  it('returns Infinity for non-finite coords', () => {
    expect(haversineKm({ lat: NaN, lng: 0 }, TLV)).toBe(Infinity);
    expect(haversineKm(TLV, { lat: 0, lng: Infinity })).toBe(Infinity);
  });
  it('is 0 for the same point', () => {
    expect(haversineKm(TLV, TLV)).toBeCloseTo(0, 5);
  });
  it('TLV→Jerusalem is ~54 km', () => {
    const d = haversineKm(TLV, JLM);
    expect(d).toBeGreaterThan(50);
    expect(d).toBeLessThan(58);
  });
  it('is symmetric', () => {
    expect(haversineKm(TLV, JLM)).toBeCloseTo(haversineKm(JLM, TLV), 6);
  });
  it('1 degree of latitude ≈ 111 km', () => {
    const d = haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });
});

describe('formatKm', () => {
  it('— for invalid / negative', () => {
    expect(formatKm(Infinity)).toBe('—');
    expect(formatKm(-3)).toBe('—');
    expect(formatKm(NaN)).toBe('—');
  });
  it('sub-km label', () => {
    expect(formatKm(0.4)).toBe('פחות מ־1 ק״מ');
  });
  it('one decimal under 10 km', () => {
    expect(formatKm(3.25)).toBe('3.3 ק״מ');
    expect(formatKm(1)).toBe('1.0 ק״מ');
  });
  it('rounded at / above 10 km', () => {
    expect(formatKm(10)).toBe('10 ק״מ');
    expect(formatKm(24.6)).toBe('25 ק״מ');
  });
});
