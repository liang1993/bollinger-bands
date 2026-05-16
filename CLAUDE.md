# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current State

**Pre-implementation.** The repo contains only `DESIGN.md` (the approved technical design). No code, no `package.json`, no test framework yet. Implementation will be done from scratch following the plan in `DESIGN.md`.

When the user asks for changes that touch implementation, first read [DESIGN.md](DESIGN.md) — it is the authoritative source for architecture decisions, data source contracts, and scope boundaries.

## What This Project Is

A personal-use Next.js 14 web app that displays Bollinger Bands over candlestick charts for **A-shares (沪深) and Hong Kong stocks**. Users switch between assets, change the indicator period `N` / multiplier `K`, granularity, and time range. All state is held in URL query params; nothing is persisted server-side.

## Architecture Big Picture

```
Browser (URL query → SWR) ──► Next.js Route Handlers ──► Tencent Finance (primary)
                                                         └─ East Money (A-share fallback)
                              /api/search ─────────────► East Money suggest
```

- Bollinger Bands are computed **client-side** in `lib/indicators.ts` (pure function over close prices). Changing N/K does **not** refetch data.
- Data fetches happen only when symbol / period / range changes.
- No database. See `DESIGN.md §5` for why and when this might change.

## Key Non-Obvious Constraints

These are easy to miss and have already cost research time:

- **Tencent kline endpoint caps a single response at ~800 daily candles** (≈ 3 years). The `from`/`to` params do **not** allow backfilling older history — only the most recent N candles are returned regardless. UI must cap day-K range at 3Y; longer history requires switching to weekly/monthly.
- **East Money kline returns empty for HK stocks** even with UA / Referer. East Money is A-share fallback only; HK has no fallback.
- **Tencent response field path depends on `fq` + `period`**: e.g. `data.sh600519.qfqday` for A-share qfq, but `data.hk00700.day` for HK (no `qfq` prefix). The datasource layer must normalize this.
- **Tencent row order is `[date, open, close, high, low, volume, ...]`** — `close` is in position 2, before `high`/`low`. Off-by-one here breaks the chart silently.
- **Bollinger stddev uses sample stddev (divide by N-1)** to match TradingView Pine Script `stdev`. Population stddev would differ slightly from the reference.

## Commands (after `pnpm create next-app`)

Project is not yet initialized. The first-time setup (per `DESIGN.md §11`):

```bash
pnpm create next-app .   # TypeScript, Tailwind, App Router, no src/
pnpm add lightweight-charts swr
pnpm dev                 # http://localhost:3000
```

Quick smoke checks for the kline route once implemented:

```bash
curl 'localhost:3000/api/kline?market=sh&code=600519&period=day&limit=5'
curl 'localhost:3000/api/kline?market=hk&code=00700&period=day&limit=5'
curl 'localhost:3000/api/search?q=茅台'
```

## Recommended Tools / Skills

When implementing, reach for these — they have real leverage for this stack:

| Tool / Skill | When to use |
|---|---|
| **Claude Preview MCP** (`mcp__Claude_Preview__*`) | After `Chart.tsx` first renders — screenshot + inspect to confirm K-line and BB lines draw correctly; re-check after N/K changes |
| **LSP** (deferred tool) | Live TS type errors while editing `lib/datasource.ts` and `Chart.tsx`; faster than `tsc --noEmit` round-trips |
| **`simplify` skill** | Run after each module (datasource → indicators → Chart) — catches duplicated logic before it spreads |
| **Chrome MCP** (`mcp__Claude_in_Chrome__*`) | E2E flow: search "腾讯" → pick 00700 → tweak N=50 → verify BB redraws |
| **`fewer-permission-prompts` skill** | After a few `pnpm dev` / `curl` rounds, allowlist the recurring read-only commands |

**Do NOT pull in**: the Feishu suite (calendar / minutes / approval / okr / docs unless explicitly asked for sharing), document formats (xlsx / pdf / pptx / docx), scheduling (`loop` / `schedule` / `scheduled-tasks`), `asr` / `media-fetch`, `claude-api`, `skill-creator`, `security-review` (attack surface is trivial). See `DESIGN.md §13` for the full reasoning.

## Scope Discipline

`DESIGN.md §14` lists explicit non-goals (no persistence, no auth, no US stocks / crypto, no realtime push, no Docker / CI). Stay inside that fence unless the user asks otherwise — the design's simplicity depends on it.
