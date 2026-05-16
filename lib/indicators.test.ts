import { describe, it, expect } from "vitest";
import { computeBollinger } from "./indicators";

describe("computeBollinger", () => {
  it("returns null for the first N-1 positions", () => {
    const r = computeBollinger([1, 2, 3, 4, 5, 6, 7], 3, 2);
    expect(r.middle.slice(0, 2)).toEqual([null, null]);
    expect(r.upper.slice(0, 2)).toEqual([null, null]);
    expect(r.lower.slice(0, 2)).toEqual([null, null]);
  });

  it("SMA is computed correctly with N=3", () => {
    const r = computeBollinger([1, 2, 3, 4, 5], 3, 2);
    expect(r.middle[2]).toBeCloseTo(2, 10); // (1+2+3)/3
    expect(r.middle[3]).toBeCloseTo(3, 10); // (2+3+4)/3
    expect(r.middle[4]).toBeCloseTo(4, 10); // (3+4+5)/3
  });

  it("uses *sample* stddev (divisor N-1, not N)", () => {
    // Classic stats example: [2,4,4,4,5,5,7,9], n=8
    //   population stddev = 2.0   (divisor 8)
    //   sample stddev     = 2.13809  (divisor 7)
    const r = computeBollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 1);
    expect(r.middle[7]).toBeCloseTo(5, 10);
    const stdev = (r.upper[7] as number) - (r.middle[7] as number);
    expect(stdev).toBeCloseTo(2.138089935, 6);
    // sanity: must NOT equal the population value 2.0
    expect(Math.abs(stdev - 2)).toBeGreaterThan(0.05);
  });

  it("K multiplier scales the band width linearly", () => {
    const data = [2, 4, 4, 4, 5, 5, 7, 9];
    const k1 = computeBollinger(data, 8, 1);
    const k2 = computeBollinger(data, 8, 2);
    const w1 = (k1.upper[7] as number) - (k1.middle[7] as number);
    const w2 = (k2.upper[7] as number) - (k2.middle[7] as number);
    expect(w2 / w1).toBeCloseTo(2, 10);
  });

  it("upper and lower are symmetric around middle", () => {
    const r = computeBollinger([10, 12, 14, 11, 13, 15, 12, 14], 5, 2);
    for (let i = 0; i < r.middle.length; i++) {
      if (r.middle[i] == null) continue;
      const m = r.middle[i] as number;
      const u = r.upper[i] as number;
      const l = r.lower[i] as number;
      expect(u - m).toBeCloseTo(m - l, 10);
    }
  });

  it("returns all nulls when input length < N", () => {
    const r = computeBollinger([1, 2, 3], 5, 2);
    expect(r.middle.every((v) => v === null)).toBe(true);
    expect(r.upper.every((v) => v === null)).toBe(true);
    expect(r.lower.every((v) => v === null)).toBe(true);
  });

  it("does not throw on empty input", () => {
    expect(() => computeBollinger([], 20, 2)).not.toThrow();
    const r = computeBollinger([], 20, 2);
    expect(r.middle).toEqual([]);
  });
});
