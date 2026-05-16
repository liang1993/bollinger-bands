"use client";

// Lightweight-Charts v5 wrapper. Single chart instance per mount.
// Series data is replaced via setData() on every prop change to avoid
// recreating the chart (which would lose pan/zoom state).

import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type LineData,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle } from "@/lib/datasource";
import type { BollingerBands } from "@/lib/indicators";

interface ChartProps {
  candles: Candle[];
  bb: BollingerBands;
}

/** Convert "YYYY-MM-DD" or "YYYY-MM-DD HH:mm" to lightweight-charts Time. */
function toTime(s: string): Time {
  // Day+: "YYYY-MM-DD" works as BusinessDay/string time
  if (s.length === 10) return s as unknown as Time;
  // Minute granularity: convert to UTC timestamp
  const t = Date.parse(s.replace(" ", "T") + "+08:00") / 1000;
  return t as UTCTimestamp;
}

export default function Chart({ candles, bb }: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const middleRef = useRef<ISeriesApi<"Line"> | null>(null);
  const upperRef = useRef<ISeriesApi<"Line"> | null>(null);
  const lowerRef = useRef<ISeriesApi<"Line"> | null>(null);

  // Create chart once.
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: "#0b0e14" },
        textColor: "#cbd5e1",
      },
      grid: {
        vertLines: { color: "#1f2937" },
        horzLines: { color: "#1f2937" },
      },
      rightPriceScale: { borderColor: "#374151" },
      timeScale: { borderColor: "#374151", rightOffset: 6 },
      crosshair: { mode: 1 },
      autoSize: true,
    });
    chartRef.current = chart;

    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: "#ef4444",       // red = up (A-share convention)
      downColor: "#22c55e",     // green = down
      borderUpColor: "#ef4444",
      borderDownColor: "#22c55e",
      wickUpColor: "#ef4444",
      wickDownColor: "#22c55e",
    });

    middleRef.current = chart.addSeries(LineSeries, {
      color: "#fbbf24", lineWidth: 1, priceLineVisible: false,
      lastValueVisible: false,
    });
    upperRef.current = chart.addSeries(LineSeries, {
      color: "rgba(96,165,250,0.85)", lineWidth: 1, priceLineVisible: false,
      lastValueVisible: false,
    });
    lowerRef.current = chart.addSeries(LineSeries, {
      color: "rgba(96,165,250,0.85)", lineWidth: 1, priceLineVisible: false,
      lastValueVisible: false,
    });

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  // Push data on every change.
  useEffect(() => {
    if (!candleSeriesRef.current) return;
    const cs: CandlestickData[] = candles.map((c) => ({
      time: toTime(c.time),
      open: c.open, high: c.high, low: c.low, close: c.close,
    }));
    candleSeriesRef.current.setData(cs);

    const lineData = (vals: (number | null)[]): LineData[] =>
      candles
        .map((c, i) => ({ time: toTime(c.time), value: vals[i] }))
        .filter((d) => d.value != null) as LineData[];

    middleRef.current?.setData(lineData(bb.middle));
    upperRef.current?.setData(lineData(bb.upper));
    lowerRef.current?.setData(lineData(bb.lower));

    chartRef.current?.timeScale().fitContent();
  }, [candles, bb]);

  return <div ref={containerRef} className="h-[520px] w-full" />;
}
