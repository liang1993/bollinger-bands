import { NextRequest, NextResponse } from "next/server";
import { fetchKline, UpstreamError, type Period, type Fq } from "@/lib/datasource";
import type { Market } from "@/lib/symbols";
import { cacheTTL } from "@/lib/cache-policy";

const VALID_PERIODS: Period[] = ["day", "week", "month", "m5", "m15", "m30", "m60"];
const MAX_LIMIT = 800; // Tencent hard cap, see DESIGN.md §4.2

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const market = searchParams.get("market") as Market | null;
  const code = searchParams.get("code");
  const period = (searchParams.get("period") ?? "day") as Period;
  const fqParam = searchParams.get("fq");
  const limit = Math.min(
    Math.max(parseInt(searchParams.get("limit") ?? "320", 10) || 320, 5),
    MAX_LIMIT,
  );

  if (!market || !["sh", "sz", "hk"].includes(market)) {
    return NextResponse.json({ error: "invalid_market" }, { status: 400 });
  }
  if (!code || !/^[A-Z0-9]{1,8}$/i.test(code)) {
    return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  }
  if (!VALID_PERIODS.includes(period)) {
    return NextResponse.json({ error: "invalid_period" }, { status: 400 });
  }
  // Default fq: A-share = qfq, HK = none (qfq is silently ignored upstream)
  const fq: Fq = (fqParam as Fq) ?? (market === "hk" ? "none" : "qfq");

  try {
    const result = await fetchKline({ market, code, period, fq, limit });
    const latestDate = result.candles.at(-1)?.time.slice(0, 10);
    const ttl = cacheTTL(market, latestDate);
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": `public, s-maxage=${ttl}, stale-while-revalidate=30`,
      },
    });
  } catch (err) {
    if (err instanceof UpstreamError) {
      const status = err.code === "symbol_not_found" ? 404 : 502;
      return NextResponse.json({ error: err.code }, { status });
    }
    return NextResponse.json({ error: "upstream_unavailable" }, { status: 502 });
  }
}
