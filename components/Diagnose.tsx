"use client";

// Diagnostic panel: surface state + history, never recommend a buy/sell.
// Wording deliberately avoids "建议" / "应该" / "看多看空" — every line is
// either a measured number or a generic educational note.

import { useMemo } from "react";
import type { Candle } from "@/lib/datasource";
import { diagnose, type Diagnosis, type MarketState } from "@/lib/diagnose";

interface Props {
  candles: Candle[];
  n: number;
  k: number;
}

export default function Diagnose({ candles, n, k }: Props) {
  const result = useMemo<Diagnosis | null>(() => {
    if (candles.length === 0) return null;
    return diagnose({ closes: candles.map((c) => c.close), n, k });
  }, [candles, n, k]);

  if (!result) {
    return (
      <Card title="行情诊断">
        <p className="text-xs text-slate-500">
          数据不足以诊断（至少需要 {n * 2} 根 K 线）。
        </p>
      </Card>
    );
  }

  return (
    <Card title="行情诊断" subtitle="仅供参考，不构成投资建议">
      <div className="space-y-5">
        <StateBlock d={result} />
        <MetricsGrid d={result} />
        {result.lookalike && <Lookalike d={result} />}
        <Meaning state={result.state} />
      </div>
    </Card>
  );
}

function Card({
  title, subtitle, children,
}: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-5">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-base font-semibold text-slate-200">{title}</h2>
        {subtitle && (
          <span className="text-[11px] text-slate-500">{subtitle}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function StateBlock({ d }: { d: Diagnosis }) {
  const color = stateColor(d.state);
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] uppercase tracking-wider text-slate-500">
        当前状态
      </div>
      <div className={`text-lg font-semibold ${color}`}>{d.stateLabel}</div>
      {(d.streakLower >= 3 || d.streakUpper >= 3) && (
        <div className="text-xs text-slate-500">
          已连续 {Math.max(d.streakLower, d.streakUpper)} 个交易日
          {d.streakLower >= 3 ? " %B<20%" : " %B>80%"}
        </div>
      )}
    </div>
  );
}

function MetricsGrid({ d }: { d: Diagnosis }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
      <Metric label="%B 位置" value={`${d.pctB.toFixed(1)}%`}
        hint={pctBHint(d.pctB)} />
      <Metric label="带宽" value={`${d.bandwidth.toFixed(2)}%`}
        hint={`60日 ${d.bandwidthRank.toFixed(0)}分位`} />
      <Metric label="带宽 5 日变化"
        value={`${d.bandwidth5dChange >= 0 ? "+" : ""}${d.bandwidth5dChange.toFixed(2)}%`}
        hint={bw5dHint(d.bandwidth5dChange)} />
      <Metric label="中轨 10 日斜率"
        value={`${d.middleSlope10d >= 0 ? "+" : ""}${d.middleSlope10d.toFixed(2)}%`}
        hint={slopeHint(d.middleSlope10d)} />
      <Metric label="距中轨"
        value={`${d.distToMiddle >= 0 ? "+" : ""}${d.distToMiddle.toFixed(2)}%`}
        hint="价格相对 20 日均价" />
      <Metric label="近 60 日触上轨"
        value={`${d.touchesUpper60d} 次`}
        hint="收盘 %B ≥ 95%" />
      <Metric label="近 60 日触下轨"
        value={`${d.touchesLower60d} 次`}
        hint="收盘 %B ≤ 5%" />
    </div>
  );
}

function Metric({
  label, value, hint,
}: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md bg-slate-900/60 border border-slate-800 p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className="text-sm font-mono text-slate-200 mt-0.5">{value}</div>
      {hint && <div className="text-[10px] text-slate-500 mt-0.5">{hint}</div>}
    </div>
  );
}

function Lookalike({ d }: { d: Diagnosis }) {
  const lk = d.lookalike!;
  return (
    <div className="space-y-2">
      <div className="text-[11px] uppercase tracking-wider text-slate-500">
        本标的历史样本（{lk.description}）
      </div>
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="text-slate-500 text-[10px]">
            <th className="text-left py-1">后续</th>
            <th className="text-right">平均涨跌</th>
            <th className="text-right">胜率</th>
            <th className="text-right">区间</th>
          </tr>
        </thead>
        <tbody>
          {lk.forwardReturns.map((r) => (
            <tr key={r.horizon} className="border-t border-slate-800/60">
              <td className="py-1 text-slate-400">{r.horizon} 日</td>
              <td className={`text-right ${r.mean >= 0 ? "text-red-400" : "text-emerald-400"}`}>
                {r.mean >= 0 ? "+" : ""}{r.mean.toFixed(2)}%
              </td>
              <td className="text-right text-slate-300">{r.winRate.toFixed(0)}%</td>
              <td className="text-right text-slate-500">
                [{r.min.toFixed(1)}%, {r.max.toFixed(1)}%]
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-slate-500">
        样本量：{lk.sampleCount}
        {lk.underpowered && " ⚠️ 样本量小，无统计显著性，仅作参考"}
      </p>
    </div>
  );
}

function Meaning({ state }: { state: MarketState }) {
  const points = meaningFor(state);
  return (
    <div className="space-y-2">
      <div className="text-[11px] uppercase tracking-wider text-slate-500">
        该状态意味着 / 不意味着
      </div>
      <ul className="space-y-1 text-xs text-slate-400">
        {points.map((p, i) => (
          <li key={i} className="flex gap-2">
            <span className="shrink-0 w-4">{p.icon}</span>
            <span>{p.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- text helpers ----

function stateColor(state: MarketState): string {
  switch (state) {
    case "walk_upper":
    case "trend_up":
      return "text-red-400";
    case "walk_lower":
    case "trend_down":
      return "text-emerald-400";
    case "squeeze":
      return "text-amber-300";
    case "expansion_top":
      return "text-fuchsia-300";
    case "range":
      return "text-slate-300";
    default:
      return "text-slate-400";
  }
}

function pctBHint(v: number): string {
  if (v >= 80) return "近上轨";
  if (v >= 60) return "上半区";
  if (v >= 40) return "中轨附近";
  if (v >= 20) return "下半区";
  return "近下轨";
}
function bw5dHint(v: number): string {
  if (v > 1) return "快速扩张";
  if (v < -1) return "快速收缩";
  return "稳定";
}
function slopeHint(v: number): string {
  if (v > 1) return "上行";
  if (v < -1) return "下行";
  return "走平";
}

function meaningFor(state: MarketState): { icon: string; text: string }[] {
  switch (state) {
    case "walk_lower":
      return [
        { icon: "✓", text: "趋势性下跌已确立，不是单日噪声" },
        { icon: "✗", text: "%B 低不等于该买入；趋势市里 %B 可以连续 5-20 天处于 0-20%" },
        { icon: "?", text: "关键观察：带宽何时开始收缩 + 中轨斜率何时翻平 → 才考虑反转" },
      ];
    case "walk_upper":
      return [
        { icon: "✓", text: "趋势性上涨已确立，强势特征" },
        { icon: "✗", text: "%B 高不等于该卖出；趋势市里 %B 可以连续 5-20 天处于 80-100%" },
        { icon: "?", text: "关键观察：带宽何时开始收缩 + 是否出现长上影/缩量 → 才考虑止盈" },
      ];
    case "squeeze":
      return [
        { icon: "✓", text: "波动率压缩到极致，多空力量平衡" },
        { icon: "✗", text: "不告诉你方向 —— 突破方向需要等量价确认" },
        { icon: "?", text: "关键观察：放量突破上轨或下轨，回踩不破再考虑跟随" },
      ];
    case "expansion_top":
      return [
        { icon: "✓", text: "波动率已到达近期极端，趋势可能进入衰竭" },
        { icon: "✗", text: "不是反转信号 —— 强趋势可以在极端波动率下继续走" },
        { icon: "?", text: "关键观察：是否出现双顶/双底、长影线、量能背离" },
      ];
    case "trend_up":
      return [
        { icon: "✓", text: "中轨向上，多头格局" },
        { icon: "?", text: "回踩中轨是趋势市的常见入场点，但需要其他维度确认" },
      ];
    case "trend_down":
      return [
        { icon: "✓", text: "中轨向下，空头格局" },
        { icon: "?", text: "反弹到中轨往往遇压，趋势未反转前的反弹大多是诱多" },
      ];
    case "range":
      return [
        { icon: "✓", text: "中轨平、价格围绕中轨震荡 —— 区间市特征" },
        { icon: "?", text: "区间策略：触下轨试多、触上轨试空；趋势策略此时大概率亏钱" },
      ];
    default:
      return [
        { icon: "?", text: "信号混合，没有清晰的状态结论，建议等更明确的形态" },
      ];
  }
}
