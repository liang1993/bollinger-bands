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

// ---- East Money suggest (search) ----

const EM_SUGGEST =
  "https://searchadapter.eastmoney.com/api/suggest/get?type=14&token=D43BF722C8E33BDC906FB84D85E326E8";

export interface SearchHit {
  market: Market;
  code: string;
  name: string;
  label: string;
}

interface EmRow {
  Code: string;
  Name: string;
  MktNum: string;
  SecurityTypeName: string;
}

interface EmResponse {
  QuotationCodeTable?: { Data?: EmRow[] };
}

/** Map East Money MktNum → our market prefix. */
function mapMarket(mktNum: string): Market | null {
  switch (mktNum) {
    case "1":
      return "sh";
    case "0":
      return "sz";
    case "116":
      return "hk";
    default:
      return null;
  }
}

const ALLOWED_TYPE_NAMES = new Set([
  "沪A",
  "深A",
  "港股",
  "创业板",
  "科创板",
]);

export async function searchSymbols(
  q: string,
  signal?: AbortSignal,
): Promise<SearchHit[]> {
  const url = `${EM_SUGGEST}&count=10&input=${encodeURIComponent(q)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new UpstreamError(`eastmoney http ${res.status}`, "upstream_http");
  const json = (await res.json()) as EmResponse;
  const rows = json.QuotationCodeTable?.Data ?? [];
  const out: SearchHit[] = [];
  for (const r of rows) {
    const market = mapMarket(r.MktNum);
    if (!market) continue;
    if (!ALLOWED_TYPE_NAMES.has(r.SecurityTypeName)) continue;
    out.push({
      market,
      code: r.Code,
      name: r.Name,
      label: `${r.Name} (${market}${r.Code} ${r.SecurityTypeName})`,
    });
  }
  return out;
}
