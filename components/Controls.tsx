"use client";

import type { Period, Fq } from "@/lib/datasource";

export type RangeKey = "1M" | "3M" | "6M" | "1Y" | "2Y" | "3Y";

export const RANGE_TO_LIMIT: Record<RangeKey, number> = {
  "1M": 22,
  "3M": 66,
  "6M": 132,
  "1Y": 250,
  "2Y": 500,
  "3Y": 750,
};

const PERIODS: { value: Period; label: string }[] = [
  { value: "day", label: "日" },
  { value: "week", label: "周" },
  { value: "month", label: "月" },
  { value: "m60", label: "60m" },
  { value: "m30", label: "30m" },
  { value: "m15", label: "15m" },
  { value: "m5", label: "5m" },
];

const RANGES: RangeKey[] = ["1M", "3M", "6M", "1Y", "2Y", "3Y"];

interface Props {
  period: Period;
  range: RangeKey;
  fq: Fq;
  n: number;
  k: number;
  onChange: (patch: Partial<{
    period: Period;
    range: RangeKey;
    fq: Fq;
    n: number;
    k: number;
  }>) => void;
}

export default function Controls({ period, range, fq, n, k, onChange }: Props) {
  // Day-K range over 3Y hits Tencent's ~800-row cap; UI prevents that combo
  // (see DESIGN.md §5.3). For intraday/week/month we don't surface range.
  const isDay = period === "day";

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <ButtonGroup
        label="粒度"
        options={PERIODS.map((p) => ({ value: p.value, label: p.label }))}
        value={period}
        onChange={(v) => onChange({ period: v as Period })}
      />

      {isDay && (
        <ButtonGroup
          label="区间"
          options={RANGES.map((r) => ({ value: r, label: r }))}
          value={range}
          onChange={(v) => onChange({ range: v as RangeKey })}
        />
      )}

      <ButtonGroup
        label="复权"
        options={[
          { value: "qfq", label: "前复权" },
          { value: "hfq", label: "后复权" },
          { value: "none", label: "不复权" },
        ]}
        value={fq}
        onChange={(v) => onChange({ fq: v as Fq })}
      />

      <NumberField
        label="N"
        value={n}
        min={5}
        max={200}
        step={1}
        onChange={(v) => onChange({ n: v })}
      />
      <NumberField
        label="K"
        value={k}
        min={0.5}
        max={5}
        step={0.1}
        onChange={(v) => onChange({ k: v })}
      />
    </div>
  );
}

function ButtonGroup<V extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: V; label: string }[];
  value: V;
  onChange: (v: V) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-slate-500 text-xs">{label}</span>
      <div className="flex rounded-md overflow-hidden border border-slate-800">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={
              "px-2.5 py-1 text-xs transition-colors " +
              (o.value === value
                ? "bg-amber-500/15 text-amber-300"
                : "text-slate-400 hover:bg-slate-800/60")
            }
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-slate-500 text-xs">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isFinite(v)) return;
          onChange(Math.min(max, Math.max(min, v)));
        }}
        className="w-16 px-2 py-1 text-xs bg-slate-900 border border-slate-800 rounded-md text-slate-200 font-mono"
      />
    </div>
  );
}
