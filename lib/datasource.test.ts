// Datasource tests focus on the easy-to-miss contracts:
//  - Tencent row order is [date, open, close, high, low, volume]
//  - HK uses 'day' key regardless of fq; A-share qfq uses 'qfqday'
//  - smartbox entries are market~code~\uXXXX-name~pinyin~type, filtered by type

import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchKline, searchSymbols, UpstreamError } from "./datasource";

const realFetch = globalThis.fetch;

function mockFetchOnce(body: unknown, status = 200) {
  globalThis.fetch = vi.fn().mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status }),
  );
}

function mockFetchTextOnce(body: string, status = 200) {
  globalThis.fetch = vi.fn().mockResolvedValueOnce(
    new Response(body, { status }),
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

describe("searchSymbols — Tencent smartbox mapping", () => {
  it("keeps sh/sz/hk stocks, decodes names, and drops index/fund/warrant/B-share", async () => {
    // Real fixture shape from curl (names are \uXXXX-escaped ASCII).
    mockFetchTextOnce(
      'v_hint="sh~600519~\\u8d35\\u5dde\\u8305\\u53f0~gzmt~GP-A' +
        "^sz~300750~\\u5b81\\u5fb7\\u65f6\\u4ee3~ndsd~GP-A" +
        "^hk~00700~\\u817e\\u8baf\\u63a7\\u80a1~txkg~GP" +
        "^sh~688981~\\u4e2d\\u82af\\u56fd\\u9645~zxgj~GP-A-KCB" +
        "^sh~000001~\\u4e0a\\u8bc1\\u6307\\u6570~szzs~ZS" +
        "^jj~000001~\\u534e\\u590f\\u6210\\u957f~hxcz~KJ" +
        "^hk~60060~\\u718aB~zyry~QZ-NX" +
        '^sh~900901~\\u4e91\\u8d5bB\\u80a1~ysbg~GP-B"',
    );
    const hits = await searchSymbols("test");
    expect(hits.map((h) => `${h.market}${h.code}`)).toEqual([
      "sh600519", "sz300750", "hk00700", "sh688981",
    ]);
    expect(hits[0].name).toBe("贵州茅台");
    expect(hits[0].label).toContain("沪A");
    expect(hits[3].label).toContain("科创板");
  });

  it("returns [] on the no-match sentinel", async () => {
    mockFetchTextOnce('v_hint="N";');
    const hits = await searchSymbols("nothing");
    expect(hits).toEqual([]);
  });
});
