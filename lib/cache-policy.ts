// Dynamic Cache-Control TTL based on whether the latest candle is still moving.
// DESIGN.md §5.5: pure function so it's covered by unit tests and reusable.

import type { Market } from "./symbols";

const SH_TZ = "Asia/Shanghai"; // A-share clock
const HK_TZ = "Asia/Hong_Kong"; // HK clock — same UTC+8 offset, kept explicit

/** Return YYYY-MM-DD / weekday / minutes-since-midnight in the market's local time. */
function localParts(market: Market, now: Date): {
  ymd: string;
  weekday: number; // 0=Sun..6=Sat
  minutes: number;
} {
  const tz = market === "hk" ? HK_TZ : SH_TZ;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const weekday = weekdayMap[parts.weekday as string] ?? -1;
  const ymd = `${parts.year}-${parts.month}-${parts.day}`;
  const minutes =
    Number(parts.hour === "24" ? "0" : parts.hour) * 60 + Number(parts.minute);
  return { ymd, weekday, minutes };
}

/** Within trading session for the given market, in local time. */
export function isMarketOpen(market: Market, now: Date): boolean {
  const { weekday, minutes } = localParts(market, now);
  if (weekday === 0 || weekday === 6) return false; // weekend
  if (market === "hk") {
    // HK: 9:30-12:00 + 13:00-16:00 local
    return (minutes >= 9 * 60 + 30 && minutes < 12 * 60)
      || (minutes >= 13 * 60 && minutes < 16 * 60);
  }
  // SH / SZ: 9:30-11:30 + 13:00-15:00 local
  return (minutes >= 9 * 60 + 30 && minutes < 11 * 60 + 30)
    || (minutes >= 13 * 60 && minutes < 15 * 60);
}

/**
 * TTL (seconds) for the upstream-mirroring HTTP cache.
 *  - Latest candle is today AND market open  → 60s (the bar is still moving)
 *  - Latest candle is today AND market closed → 3600s (stable until next open)
 *  - Latest candle is older than today        → 21600s (6h, historical-only)
 */
export function cacheTTL(
  market: Market,
  latestKDate: string | undefined,
  now: Date = new Date(),
): number {
  const { ymd } = localParts(market, now);
  if (!latestKDate) return 60;
  if (latestKDate !== ymd) return 21600;
  return isMarketOpen(market, now) ? 60 : 3600;
}
