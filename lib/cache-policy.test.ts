import { describe, it, expect } from "vitest";
import { cacheTTL, isMarketOpen } from "./cache-policy";

// Use ZonedDateTime via UTC math. Shanghai/HK are UTC+8 year-round (no DST),
// so a UTC date "2026-05-15T03:00:00Z" is local 11:00 in both markets.

const D = (utcIso: string) => new Date(utcIso);

describe("isMarketOpen", () => {
  it("A-share: Friday 10:00 local = open", () => {
    // 2026-05-15 (Fri) 10:00 SH = 02:00 UTC
    expect(isMarketOpen("sh", D("2026-05-15T02:00:00Z"))).toBe(true);
  });

  it("A-share: Friday 12:00 local (lunch) = closed", () => {
    expect(isMarketOpen("sh", D("2026-05-15T04:00:00Z"))).toBe(false);
  });

  it("A-share: Friday 14:30 local = open (afternoon session)", () => {
    expect(isMarketOpen("sh", D("2026-05-15T06:30:00Z"))).toBe(true);
  });

  it("A-share: Friday 15:30 local = closed (after close)", () => {
    expect(isMarketOpen("sh", D("2026-05-15T07:30:00Z"))).toBe(false);
  });

  it("HK: Friday 15:30 local = open (HK closes 16:00)", () => {
    expect(isMarketOpen("hk", D("2026-05-15T07:30:00Z"))).toBe(true);
  });

  it("Weekend: always closed", () => {
    // 2026-05-16 Sat 10:00 SH
    expect(isMarketOpen("sh", D("2026-05-16T02:00:00Z"))).toBe(false);
    expect(isMarketOpen("hk", D("2026-05-17T02:00:00Z"))).toBe(false);
  });
});

describe("cacheTTL", () => {
  it("latest candle older than today → long TTL (21600s)", () => {
    // Today in SH is 2026-05-15; latest candle is 2026-05-14
    expect(cacheTTL("sh", "2026-05-14", D("2026-05-15T02:00:00Z"))).toBe(21600);
  });

  it("latest candle is today, market open → 60s", () => {
    expect(cacheTTL("sh", "2026-05-15", D("2026-05-15T02:00:00Z"))).toBe(60);
  });

  it("latest candle is today, market closed → 3600s", () => {
    expect(cacheTTL("sh", "2026-05-15", D("2026-05-15T08:00:00Z"))).toBe(3600);
  });

  it("HK market hours differ from A-share", () => {
    // 2026-05-15 15:30 SH/HK = 07:30 UTC. SH closed, HK still open.
    expect(cacheTTL("sh", "2026-05-15", D("2026-05-15T07:30:00Z"))).toBe(3600);
    expect(cacheTTL("hk", "2026-05-15", D("2026-05-15T07:30:00Z"))).toBe(60);
  });

  it("undefined latestKDate → conservative short TTL", () => {
    expect(cacheTTL("sh", undefined, D("2026-05-15T02:00:00Z"))).toBe(60);
  });
});
