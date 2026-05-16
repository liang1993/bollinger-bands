"use client";

import useSWR from "swr";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { KlineResult } from "@/lib/datasource";
import { computeBollinger } from "@/lib/indicators";
import { DEFAULT_STATE, readState, writeState, type ViewState } from "@/lib/url-state";
import Controls, { RANGE_TO_LIMIT } from "@/components/Controls";
import AssetPicker from "@/components/AssetPicker";
import Diagnose from "@/components/Diagnose";
import type { Market } from "@/lib/symbols";

const Chart = dynamic(() => import("@/components/Chart"), { ssr: false });

const fetcher = async (url: string): Promise<KlineResult> => {
  const r = await fetch(url);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${r.status}`);
  }
  return r.json();
};

function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw === "symbol_not_found") return "找不到该代码";
  if (raw === "upstream_unavailable" || raw === "upstream_http") return "数据源不可用，请稍后重试";
  return raw;
}

export default function Page() {
  // State authority lives in React; URL is a one-way mirror updated via replaceState.
  const [state, setState] = useState<ViewState>(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);

  // Read URL on first mount, then mark hydrated so SWR can fetch.
  // (Hydrating client-only state from `window` is the textbook case for
  // setState-in-effect; the alternative — useSyncExternalStore — is overkill
  // for a one-shot read.)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(readState(params));
    setHydrated(true);
  }, []);

  // Mirror state → URL after hydration.
  useEffect(() => {
    if (hydrated) writeState(state);
  }, [hydrated, state]);

  const limit = state.period === "day"
    ? Math.min(RANGE_TO_LIMIT[state.range], 800)
    : 320;

  const url = hydrated
    ? `/api/kline?market=${state.market}&code=${state.code}` +
      `&period=${state.period}&fq=${state.fq}&limit=${limit}`
    : null;

  const { data, error, isLoading } = useSWR<KlineResult>(url, fetcher, {
    dedupingInterval: 30_000,
    revalidateOnFocus: false,
  });

  const bb = useMemo(() => {
    if (!data) return { middle: [], upper: [], lower: [] };
    return computeBollinger(
      data.candles.map((c) => c.close),
      state.n,
      state.k,
    );
  }, [data, state.n, state.k]);

  const patch = (p: Partial<ViewState>) => setState((s) => ({ ...s, ...p }));

  const pickAsset = (m: Market, code: string) => {
    // Switching market may change the sensible fq default — HK has no qfq.
    setState((s) => ({
      ...s,
      market: m,
      code,
      fq: m === "hk" ? "none" : (s.market === "hk" ? "qfq" : s.fq),
    }));
  };

  return (
    <main className="flex-1 p-4 md:p-6 max-w-6xl w-full mx-auto space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-slate-200">
          {data?.name ?? "…"}{" "}
          <span className="text-slate-500 font-mono text-sm">
            {state.market}{state.code} · {state.period} · BB({state.n},{state.k})
          </span>
        </h1>
      </header>

      <AssetPicker
        currentMarket={state.market}
        currentCode={state.code}
        onPick={pickAsset}
      />

      <Controls
        period={state.period}
        range={state.range}
        fq={state.fq}
        n={state.n}
        k={state.k}
        onChange={patch}
      />

      <div className="rounded-lg border border-slate-800 bg-slate-950/50 overflow-hidden relative">
        {error ? (
          <div className="p-8 text-red-400 text-sm">
            数据加载失败：{errorMessage(error)}
          </div>
        ) : !data && isLoading ? (
          <div className="p-8 text-slate-500 text-sm">加载中…</div>
        ) : !data ? (
          <div className="p-8 text-slate-500 text-sm">无数据</div>
        ) : (
          <>
            <Chart candles={data.candles} bb={bb} />
            {isLoading && (
              <div className="absolute top-2 right-3 text-xs text-slate-500">
                刷新中…
              </div>
            )}
          </>
        )}
      </div>

      {state.period === "day" && RANGE_TO_LIMIT[state.range] >= 750 && (
        <p className="text-xs text-slate-500">
          提示：上游接口单次最多返回约 800 根日 K（≈ 3 年）。
          看更长历史请切换到周 K 或月 K。
        </p>
      )}

      {data && (
        <Diagnose candles={data.candles} n={state.n} k={state.k} />
      )}
    </main>
  );
}
