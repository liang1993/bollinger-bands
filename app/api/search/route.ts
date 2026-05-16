import { NextRequest, NextResponse } from "next/server";
import { searchSymbols, UpstreamError } from "@/lib/datasource";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json([]);
  if (q.length > 20) {
    return NextResponse.json({ error: "query_too_long" }, { status: 400 });
  }

  try {
    const hits = await searchSymbols(q);
    return NextResponse.json(hits, {
      // Suggestion responses change rarely (codes / names); cache 1h to absorb
      // typing-debounce bursts.
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=60" },
    });
  } catch (err) {
    if (err instanceof UpstreamError) {
      return NextResponse.json({ error: err.code }, { status: 502 });
    }
    return NextResponse.json({ error: "upstream_unavailable" }, { status: 502 });
  }
}
