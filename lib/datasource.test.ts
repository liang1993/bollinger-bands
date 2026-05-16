// Datasource tests focus on the easy-to-miss contracts:
//  - Tencent row order is [date, open, close, high, low, volume]
//  - HK uses 'day' key regardless of fq; A-share qfq uses 'qfqday'
//  - East Money MktNum maps to our market prefix

import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchKline, searchSymbols, UpstreamError } from "./datasource";

const realFetch = globalThis.fetch;

function mockFetchOnce(body: unknown, status = 200) {
  globalThis.fetch = vi.fn().mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status }),
  );
}

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("fetchKline — Tencent normalization", () => {
  it("parses A-share qfqday and respects close-in-position-2", async () => {
    // Real fixture shape from curl: [date, open, close, high, low, volume, amount, ...]
    mockFetchOnce({
      code: 0,
      data: {
        sh600519: {
          qfqday: [
            ["2026-05-15", "1335.15", "1332.95", "1339.28", "1327.11", "58184", "..."],
          ],
          qt: { sh600519: ["1", "贵州茅台"] },
        },
      },
    });
    const r = await fetchKline({
      market: "sh", code: "600519", period: "day", fq: "qfq", limit: 1,
    });
    expect(r.candles).toHaveLength(1);
    const c = r.candles[0];
    expect(c.open).toBe(1335.15);
    expect(c.close).toBe(1332.95); // position 2 — the foot-gun
    expect(c.high).toBe(1339.28);
    expect(c.low).toBe(1327.11);
    expect(c.volume).toBe(58184);
    expect(r.name).toBe("贵州茅台");
  });

  it("parses HK 'day' (no qfq prefix even when fq requested)", async () => {
    mockFetchOnce({
      code: 0,
      data: {
        hk00700: {
          day: [["2026-05-15", "459.000", "456.400", "462.600", "454.200", "26449868"]],
          qt: { hk00700: ["100", "腾讯控股"] },
        },
      },
    });
    const r = await fetchKline({
      market: "hk", code: "00700", period: "day", fq: "none", limit: 1,
    });
    expect(r.candles[0].close).toBe(456.4);
    expect(r.name).toBe("腾讯控股");
  });

  it("falls back to bare period key when qfq+period is absent", async () => {
    mockFetchOnce({
      code: 0,
      data: {
        hk00700: {
          // requested qfq but only 'day' exists — HK behavior
          day: [["2026-05-15", "459", "456.4", "462.6", "454.2", "1"]],
        },
      },
    });
    const r = await fetchKline({
      market: "hk", code: "00700", period: "day", fq: "qfq", limit: 1,
    });
    expect(r.candles).toHaveLength(1);
  });

  it("throws symbol_not_found when upstream returns empty candles", async () => {
    mockFetchOnce({ code: 0, data: { sh999999: { qfqday: [] } } });
    await expect(fetchKline({
      market: "sh", code: "999999", period: "day", fq: "qfq", limit: 5,
    })).rejects.toThrow(UpstreamError);
  });

  it("throws upstream_http on non-200", async () => {
    mockFetchOnce({}, 500);
    await expect(fetchKline({
      market: "sh", code: "600519", period: "day", fq: "qfq", limit: 5,
    })).rejects.toThrow(UpstreamError);
  });

  it("coerces string numbers to numbers", async () => {
    mockFetchOnce({
      code: 0,
      data: { sh600519: { qfqday: [["2026-05-15", "10", "11", "12", "9", "100"]] } },
    });
    const r = await fetchKline({
      market: "sh", code: "600519", period: "day", fq: "qfq", limit: 1,
    });
    const c = r.candles[0];
    expect(typeof c.open).toBe("number");
    expect(typeof c.volume).toBe("number");
  });
});

describe("searchSymbols — East Money mapping", () => {
  it("maps MktNum 1/0/116 to sh/sz/hk and filters by security type", async () => {
    mockFetchOnce({
      QuotationCodeTable: {
        Data: [
          { Code: "600519", Name: "贵州茅台", MktNum: "1", SecurityTypeName: "沪A" },
          { Code: "000858", Name: "五粮液", MktNum: "0", SecurityTypeName: "深A" },
          { Code: "00700", Name: "腾讯控股", MktNum: "116", SecurityTypeName: "港股" },
          { Code: "XXX", Name: "某基金", MktNum: "1", SecurityTypeName: "场外基金" },
          { Code: "YYY", Name: "Unknown", MktNum: "999", SecurityTypeName: "沪A" },
        ],
      },
    });
    const hits = await searchSymbols("test");
    expect(hits.map((h) => `${h.market}${h.code}`)).toEqual([
      "sh600519", "sz000858", "hk00700",
    ]);
    expect(hits[0].label).toContain("贵州茅台");
    expect(hits[0].label).toContain("沪A");
  });

  it("returns [] when upstream gives no Data", async () => {
    mockFetchOnce({ QuotationCodeTable: {} });
    const hits = await searchSymbols("nothing");
    expect(hits).toEqual([]);
  });
});
