"use client";

import { useEffect, useRef, useState } from "react";
import { QUICK_SYMBOLS, type Market } from "@/lib/symbols";
import type { SearchHit } from "@/lib/datasource";

interface Props {
  currentMarket: Market;
  currentCode: string;
  onPick: (m: Market, code: string) => void;
}

export default function AssetPicker({ currentMarket, currentCode, onPick }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aborterRef = useRef<AbortController | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounce search 300ms; abort in-flight requests on every new keystroke.
  // (The setState calls below are how we surface fetch progress to the UI —
  // a textbook "synchronize React state with an external system" use of useEffect.)
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    aborterRef.current?.abort();
    if (!query.trim()) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const ac = new AbortController();
      aborterRef.current = ac;
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, {
          signal: ac.signal,
        });
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as SearchHit[];
        if (!ac.signal.aborted) setHits(j);
      } catch (e: unknown) {
        if (e instanceof Error && e.name !== "AbortError") setHits([]);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Click-outside to close the dropdown.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function pick(market: Market, code: string) {
    onPick(market, code);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className="space-y-2">
      <div ref={boxRef} className="relative">
        <input
          type="search"
          placeholder="搜索股票（代码 / 名称 / 拼音）"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-md
                     text-slate-200 placeholder-slate-600 text-sm
                     focus:outline-none focus:border-amber-500/60"
        />
        {open && query.trim() && (
          <div className="absolute z-10 mt-1 w-full max-h-72 overflow-auto
                          bg-slate-950 border border-slate-800 rounded-md shadow-lg">
            {loading ? (
              <div className="px-3 py-2 text-xs text-slate-500">搜索中…</div>
            ) : hits.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-500">无结果</div>
            ) : (
              hits.map((h) => (
                <button
                  key={`${h.market}${h.code}`}
                  onClick={() => pick(h.market, h.code)}
                  className="w-full text-left px-3 py-2 text-sm
                             hover:bg-slate-800 text-slate-200 flex justify-between gap-3"
                >
                  <span className="truncate">{h.name}</span>
                  <span className="font-mono text-xs text-slate-500 shrink-0">
                    {h.market}{h.code}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {QUICK_SYMBOLS.map((s) => {
          const active = s.market === currentMarket && s.code === currentCode;
          return (
            <button
              key={`${s.market}${s.code}`}
              onClick={() => pick(s.market, s.code)}
              className={
                "px-2 py-1 text-xs rounded-md border transition-colors " +
                (active
                  ? "bg-amber-500/15 text-amber-300 border-amber-500/40"
                  : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800")
              }
            >
              {s.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
