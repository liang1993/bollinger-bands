// URL query as state — read on mount, write via history.replaceState to keep
// the bar shareable on refresh without triggering RSC re-fetch.

import type { Market } from "./symbols";
import type { Period, Fq } from "./datasource";
import type { RangeKey } from "@/components/Controls";

export interface ViewState {
  market: Market;
  code: string;
  period: Period;
  fq: Fq;
  n: number;
  k: number;
  range: RangeKey;
}

export const DEFAULT_STATE: ViewState = {
  market: "sh",
  code: "600519",
  period: "day",
  fq: "qfq",
  n: 20,
  k: 2,
  range: "1Y",
};

const VALID_MARKETS: Market[] = ["sh", "sz", "hk"];
const VALID_PERIODS: Period[] = ["day", "week", "month", "m5", "m15", "m30", "m60"];
const VALID_FQS: Fq[] = ["qfq", "hfq", "none"];
const VALID_RANGES: RangeKey[] = ["1M", "3M", "6M", "1Y", "2Y", "3Y"];

function pick<T extends string>(v: string | null, allowed: readonly T[], fallback: T): T {
  return (v && (allowed as readonly string[]).includes(v)) ? (v as T) : fallback;
}

export function readState(search: URLSearchParams): ViewState {
  const market = pick(search.get("market"), VALID_MARKETS, DEFAULT_STATE.market);
  const code = (search.get("code") ?? DEFAULT_STATE.code).replace(/[^A-Za-z0-9]/g, "");
  const period = pick(search.get("period"), VALID_PERIODS, DEFAULT_STATE.period);
  // For HK, default to none unless the user explicitly chose otherwise.
  const fqRaw = search.get("fq");
  const fq = fqRaw
    ? pick(fqRaw, VALID_FQS, DEFAULT_STATE.fq)
    : (market === "hk" ? "none" : DEFAULT_STATE.fq);
  const n = clamp(Number(search.get("n")) || DEFAULT_STATE.n, 5, 200);
  const k = clamp(Number(search.get("k")) || DEFAULT_STATE.k, 0.5, 5);
  const range = pick(search.get("range"), VALID_RANGES, DEFAULT_STATE.range);
  return { market, code: code || DEFAULT_STATE.code, period, fq, n, k, range };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function writeState(state: ViewState) {
  if (typeof window === "undefined") return;
  const sp = new URLSearchParams();
  sp.set("market", state.market);
  sp.set("code", state.code);
  sp.set("period", state.period);
  sp.set("fq", state.fq);
  sp.set("n", String(state.n));
  sp.set("k", String(state.k));
  sp.set("range", state.range);
  const next = `${window.location.pathname}?${sp.toString()}`;
  // Use replaceState to avoid spamming the history stack on every click.
  window.history.replaceState(null, "", next);
}
