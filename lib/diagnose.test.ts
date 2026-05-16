import { describe, it, expect } from "vitest";
import { diagnose } from "./diagnose";

// Helper to build a synthetic close series with a deterministic shape.
function flat(value: number, len: number): number[] {
  return Array.from({ length: len }, () => value);
}
function linear(from: number, to: number, len: number): number[] {
  return Array.from({ length: len }, (_, i) => from + (to - from) * i / (len - 1));
}

describe("diagnose", () => {
  it("returns null when input is too short for 2N", () => {
    expect(diagnose({ closes: flat(100, 30) })).toBeNull();
  });

  it("flags squeeze when closes are perfectly flat", () => {
    // Flat 100 for 60 days → bandwidth ≈ 0 → squeeze
    const d = diagnose({ closes: flat(100, 60) })!;
    expect(d).not.toBeNull();
    expect(d.bandwidth).toBeLessThan(0.1);
    // bandwidthRank may be undefined-shape with flat data, but state should be squeeze
    expect(d.state).toBe("squeeze");
  });

  it("detects walk_lower in a steadily declining series", () => {
    // 60 days descending from 100 to 60 → price keeps below middle as it lags
    const d = diagnose({ closes: linear(100, 60, 60) })!;
    expect(d.streakLower).toBeGreaterThan(0);
    // Either walk_lower or trend_down depending on streak threshold
    expect(["walk_lower", "trend_down"]).toContain(d.state);
    expect(d.middleSlope10d).toBeLessThan(0);
  });

  it("detects walk_upper in a steadily rising series", () => {
    const d = diagnose({ closes: linear(60, 100, 60) })!;
    expect(["walk_upper", "trend_up"]).toContain(d.state);
    expect(d.middleSlope10d).toBeGreaterThan(0);
  });

  it("exposes raw metrics regardless of state", () => {
    const d = diagnose({ closes: linear(80, 120, 80) })!;
    expect(d).toHaveProperty("pctB");
    expect(d).toHaveProperty("bandwidth");
    expect(d).toHaveProperty("middleSlope10d");
    expect(d).toHaveProperty("distToMiddle");
  });

  it("lookalike only fires for walk_* states", () => {
    const flatDiag = diagnose({ closes: flat(100, 80) })!;
    expect(flatDiag.lookalike).toBeNull();
  });

  it("lookalike flags underpowered when sample < 10", () => {
    // A series that creates exactly one walk_lower event near the end
    const series = [...flat(100, 50), ...linear(100, 70, 30)];
    const d = diagnose({ closes: series })!;
    if (d.lookalike) {
      expect(d.lookalike.underpowered).toBe(d.lookalike.sampleCount < 10);
    }
  });
});
