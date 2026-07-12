// Upstream → normalized OHLCV.
// DESIGN.md §4.3: Tencent rows are [date, open, close, high, low, volume, ...] —
// note close in position 2, before high/low. Off-by-one here is the kind of bug
// that silently misrenders the chart, so we keep this layer thin and tested.

import type { Market } from "./symbols";

export type Period = "day" | "week" | "month" | "m5" | "m15" | "m30" | "m60";
export type Fq = "qfq" | "hfq" | "none";

export interface Candle {
  time: string; // "YYYY-MM-DD" for day+ ; "YYYY-MM-DD HH:mm" for minute
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface KlineResult {
  symbol: string; // e.g. "sh600519"
  name: string;
  period: Period;
  fq: Fq;
  candles: Candle[];
}

const TENCENT_KLINE = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get";

/** Build the Tencent `param` value. */
function buildTencentParam(
  market: Market,
  code: string,
  period: Period,
  limit: number,
  fq: Fq,
): string {
  const sym = `${market}${code}`;
  const fqPart = fq === "none" ? "" : fq;
  return `${sym},${period},,,${limit},${fqPart}`;
}

/**
 * Tencent's response key is `${fqType?}${period}`:
 *   data.sh600519.qfqday   (A-share, qfq)
 *   data.sh600519.day      (A-share, none)
 *   data.hk00700.day       (HK is always 'day' regardless of fq)
 *
 * HK qfq is silently ignored upstream, so we read whichever key exists.
 */
function pickRowsKey(period: Period, fq: Fq): string[] {
  // Order matters: try requested key first, then fall back.
  if (fq === "none") return [period];
  return [`${fq}${period}`, period];
}

interface TencentSymbolPayload {
  [key: string]: unknown;
  qt?: { [k: string]: (string | number)[] };
}

interface TencentResponse {
  code: number;
  msg?: string;
  data?: { [symbol: string]: TencentSymbolPayload };
}

export async function fetchKline(opts: {
  market: Market;
  code: string;
  period: Period;
  fq: Fq;
  limit: number;
  signal?: AbortSignal;
}): Promise<KlineResult> {
  const { market, code, period, fq, limit, signal } = opts;
  const sym = `${market}${code}`;
  const param = buildTencentParam(market, code, period, limit, fq);
  const url = `${TENCENT_KLINE}?param=${encodeURIComponent(param)}`;

  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new UpstreamError(`tencent http ${res.status}`, "upstream_http");
  }
  const json = (await res.json()) as TencentResponse;
  if (json.code !== 0 || !json.data || !json.data[sym]) {
    throw new UpstreamError(`tencent code ${json.code}`, "symbol_not_found");
  }

  const payload = json.data[sym];

  // Find the rows array under one of the candidate keys.
  let rows: unknown[] | null = null;
  for (const k of pickRowsKey(period, fq)) {
    const v = payload[k];
    if (Array.isArray(v)) {
      rows = v;
      break;
    }
  }
  if (!rows) {
    throw new UpstreamError("kline rows missing", "symbol_not_found");
  }

  // Resolve name from qt block when available; fall back to symbol.
  const name = (payload.qt?.[sym]?.[1] as string | undefined) ?? sym;

  const candles = parseRows(rows);
  if (candles.length === 0) {
    throw new UpstreamError("empty candles", "symbol_not_found");
  }

  return { symbol: sym, name, period, fq, candles };
}

/** Parse raw rows: [date, open, close, high, low, volume, ...]. */
function parseRows(rows: unknown[]): Candle[] {
  const out: Candle[] = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 6) continue;
    const time = String(r[0]);
    const open = num(r[1]);
    const close = num(r[2]);
    const high = num(r[3]);
    const low = num(r[4]);
    const volume = num(r[5]);
    if ([open, close, high, low].some((v) => !Number.isFinite(v))) continue;
    out.push({ time, open, high, low, close, volume });
  }
  return out;
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  return NaN;
}

export type UpstreamErrorCode =
  | "upstream_http"
  | "symbol_not_found"
  | "upstream_unavailable";

export class UpstreamError extends Error {
  code: UpstreamErrorCode;
  constructor(msg: string, code: UpstreamErrorCode) {
    super(msg);
    this.code = code;
  }
}

// ---- Tencent smartbox (search) ----
// East Money's searchadapter works from residential IPs but rejects/blackholes
// requests from datacenter egress (Vercel), so search uses Tencent smartbox —
// same upstream family as the kline source, which is proven reachable there.

const SMARTBOX = "https://smartbox.gtimg.cn/s3/?v=2&t=all";

export interface SearchHit {
  market: Market;
  code: string;
  name: string;
  label: string;
}

/**
 * Accept only tradable stocks in our three markets; everything else in the
 * smartbox mix (ZS index, KJ fund, QZ warrant, GP-B B-share) is dropped.
 * Returns the Chinese type label for display, or null to drop the row.
 */
function acceptType(market: Market, type: string): string | null {
  if (market === "hk") return type === "GP" ? "港股" : null;
  if (type === "GP-A") return market === "sh" ? "沪A" : "深A";
  if (type === "GP-A-KCB") return "科创板";
  return null;
}

/** Names arrive as ASCII with \uXXXX escapes (even under the GBK header). */
function decodeUnicodeEscapes(s: string): string {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) =>
    String.fromCharCode(parseInt(h, 16)),
  );
}

const MARKETS = new Set<Market>(["sh", "sz", "hk"]);

export async function searchSymbols(
  q: string,
  signal?: AbortSignal,
): Promise<SearchHit[]> {
  const url = `${SMARTBOX}&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new UpstreamError(`smartbox http ${res.status}`, "upstream_http");
  const text = await res.text();

  // Body is `v_hint="entry^entry^..."` where entry = market~code~name~pinyin~type;
  // no match yields `v_hint="N"`.
  const payload = text.match(/"([^"]*)"/)?.[1] ?? "";
  if (!payload || payload === "N") return [];

  const out: SearchHit[] = [];
  for (const entry of payload.split("^")) {
    const parts = entry.split("~");
    if (parts.length < 5) continue;
    const [mkt, code, rawName, , type] = parts;
    if (!MARKETS.has(mkt as Market)) continue;
    const market = mkt as Market;
    const typeName = acceptType(market, type);
    if (!typeName) continue;
    const name = decodeUnicodeEscapes(rawName);
    out.push({
      market,
      code,
      name,
      label: `${name} (${market}${code} ${typeName})`,
    });
  }
  return out;
}
