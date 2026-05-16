// Bollinger Bands diagnostic — pure functions, no side effects.
// Philosophy: describe the state, surface historical context, never tell the
// user to buy or sell. See app/page.tsx where the wording is enforced again.

import { computeBollinger } from "./indicators";

export type MarketState =
  | "walk_upper"      // walking the upper band — strong uptrend
  | "walk_lower"      // walking the lower band — strong downtrend
  | "squeeze"         // bandwidth at its 60-day floor
  | "expansion_top"   // bandwidth at its 60-day ceiling
  | "trend_up"        // middle sloping up, no walking
  | "trend_down"      // middle sloping down, no walking
  | "range"           // flat middle, price oscillating around it
  | "mixed";          // doesn't fit any clear bucket

export interface DiagnoseInput {
  closes: number[];
  n?: number;
  k?: number;
}

export interface Diagnosis {
  // Raw derived metrics (always shown, even when state is "mixed")
  pctB: number;            // 0..100, where 50 = middle, 0 = lower, 100 = upper
  bandwidth: number;       // (upper - lower) / middle, percent
  bandwidthRank: number;   // 0..100 percentile of bandwidth over last 60 days
  bandwidth5dChange: number; // bandwidth now - bandwidth 5 trading days ago
  middleSlope10d: number;  // middle[-1] / middle[-11] - 1, percent
  streakLower: number;     // consecutive days %B < 20
  streakUpper: number;     // consecutive days %B > 80
  touchesUpper60d: number; // closes >= upper (i.e. %B >= 95) in last 60 days
  touchesLower60d: number; // closes <= lower (i.e. %B <= 5)  in last 60 days
  distToMiddle: number;    // (close - middle) / middle, percent

  // Bucketed state
  state: MarketState;
  stateLabel: string;      // human-readable Chinese label

  // Historical context — what happened on this symbol after similar states
  lookalike: Lookalike | null;
}

export interface Lookalike {
  description: string;
  sampleCount: number;
  forwardReturns: { horizon: number; mean: number; winRate: number; min: number; max: number }[];
  /** True when sampleCount < 10 — the stats are still shown but flagged. */
  underpowered: boolean;
}

/** Run the full diagnosis. Returns null when not enough data (need 2N+ candles). */
export function diagnose({ closes, n = 20, k = 2 }: DiagnoseInput): Diagnosis | null {
  if (closes.length < n * 2) return null;

  const bb = computeBollinger(closes, n, k);
  const last = closes.length - 1;
  const middle = bb.middle[last]!;
  const upper = bb.upper[last]!;
  const lower = bb.lower[last]!;
  const close = closes[last];

  const pctB = (close - lower) / (upper - lower) * 100;

  // %B + bandwidth time series (aligned to closes[i] where i >= n-1)
  const pctBSeries: number[] = [];
  const bwSeries: number[] = [];
  for (let i = n - 1; i < closes.length; i++) {
    const m = bb.middle[i]!;
    const u = bb.upper[i]!;
    const l = bb.lower[i]!;
    pctBSeries.push((closes[i] - l) / (u - l) * 100);
    bwSeries.push((u - l) / m * 100);
  }

  const bandwidth = bwSeries.at(-1)!;
  const last60Bw = bwSeries.slice(-60);
  const bandwidthRank =
    last60Bw.filter((v) => v <= bandwidth).length / last60Bw.length * 100;
  const bandwidth5dChange = bwSeries.length >= 6
    ? bandwidth - bwSeries[bwSeries.length - 6]
    : 0;

  const middleSlope10d = bb.middle.length >= 11 && bb.middle[last - 10] != null
    ? (middle / bb.middle[last - 10]! - 1) * 100
    : 0;

  let streakLower = 0;
  for (let i = pctBSeries.length - 1; i >= 0; i--) {
    if (pctBSeries[i] < 20) streakLower++; else break;
  }
  let streakUpper = 0;
  for (let i = pctBSeries.length - 1; i >= 0; i--) {
    if (pctBSeries[i] > 80) streakUpper++; else break;
  }

  const last60Pct = pctBSeries.slice(-60);
  const touchesUpper60d = last60Pct.filter((v) => v >= 95).length;
  const touchesLower60d = last60Pct.filter((v) => v <= 5).length;

  const distToMiddle = (close - middle) / middle * 100;

  const { state, stateLabel } = classifyState({
    streakUpper, streakLower, bandwidth, bandwidthRank, bandwidth5dChange,
    middleSlope10d, pctB,
  });

  const lookalike = computeLookalike(closes, pctBSeries, n, state);

  return {
    pctB, bandwidth, bandwidthRank, bandwidth5dChange, middleSlope10d,
    streakUpper, streakLower, touchesUpper60d, touchesLower60d, distToMiddle,
    state, stateLabel, lookalike,
  };
}

interface ClassifyInput {
  streakUpper: number;
  streakLower: number;
  bandwidth: number;
  bandwidthRank: number;
  bandwidth5dChange: number;
  middleSlope10d: number;
  pctB: number;
}

function classifyState(i: ClassifyInput): { state: MarketState; stateLabel: string } {
  if (i.streakUpper >= 3) return { state: "walk_upper", stateLabel: "强势趋势 · 沿上轨行走" };
  if (i.streakLower >= 3) return { state: "walk_lower", stateLabel: "弱势趋势 · 沿下轨行走" };
  // Squeeze if either bandwidth is extremely low (synthetic / illiquid case)
  // or it's at the lowest quintile of the last 60 trading days.
  if (i.bandwidth < 0.5 || i.bandwidthRank <= 20) {
    return { state: "squeeze", stateLabel: "收口待变盘" };
  }
  if (i.bandwidthRank >= 85 && Math.abs(i.bandwidth5dChange) < 0.5) {
    return { state: "expansion_top", stateLabel: "扩张顶端 · 趋势可能衰竭" };
  }
  if (i.middleSlope10d > 1) return { state: "trend_up", stateLabel: "多头趋势中" };
  if (i.middleSlope10d < -1) return { state: "trend_down", stateLabel: "空头趋势中" };
  if (Math.abs(i.middleSlope10d) < 0.5 && i.pctB > 25 && i.pctB < 75) {
    return { state: "range", stateLabel: "中轨震荡" };
  }
  return { state: "mixed", stateLabel: "混合状态 · 信号不明" };
}

/**
 * Find historical occurrences of the same state on the same symbol,
 * then summarize forward 5/10/20-day returns.
 *
 * We deliberately use the same symbol's history, not a cross-symbol prior —
 * a small but personal sample is more honest than a large but irrelevant one.
 */
function computeLookalike(
  closes: number[],
  pctBSeries: number[],
  n: number,
  state: MarketState,
): Lookalike | null {
  // Only compute for states with a clear definition.
  const matcher = stateMatcher(state);
  if (!matcher) return null;

  // pctBSeries[i] corresponds to closes[i + n - 1]
  const events: number[] = [];
  for (let i = 5; i < pctBSeries.length - 21; i++) {
    if (matcher(pctBSeries, i) && !matcher(pctBSeries, i - 1)) {
      events.push(i + n - 1); // index into closes[]
    }
  }

  // Skip events too close to "now" to avoid leakage.
  const cutoff = closes.length - 21;
  const usableEvents = events.filter((e) => e <= cutoff);
  if (usableEvents.length === 0) return null;

  const horizons = [5, 10, 20];
  const forwardReturns = horizons.map((h) => {
    const rs = usableEvents
      .map((e) => closes[e + h] / closes[e] - 1)
      .map((r) => r * 100);
    const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
    const winRate = rs.filter((r) => r > 0).length / rs.length * 100;
    return {
      horizon: h, mean, winRate,
      min: Math.min(...rs), max: Math.max(...rs),
    };
  });

  return {
    description: stateDescription(state),
    sampleCount: usableEvents.length,
    forwardReturns,
    underpowered: usableEvents.length < 10,
  };
}

function stateMatcher(state: MarketState): ((s: number[], i: number) => boolean) | null {
  switch (state) {
    case "walk_lower":
      return (s, i) => i >= 4 && s.slice(i - 4, i + 1).every((v) => v < 20);
    case "walk_upper":
      return (s, i) => i >= 4 && s.slice(i - 4, i + 1).every((v) => v > 80);
    case "squeeze":
    case "expansion_top":
    case "trend_up":
    case "trend_down":
    case "range":
    case "mixed":
    default:
      // For states defined by bandwidth/slope, we'd need separate series.
      // Skip lookalike — the headline stats are enough.
      return null;
  }
}

function stateDescription(state: MarketState): string {
  switch (state) {
    case "walk_lower": return "沿下轨行走 5 天后";
    case "walk_upper": return "沿上轨行走 5 天后";
    default: return "";
  }
}
