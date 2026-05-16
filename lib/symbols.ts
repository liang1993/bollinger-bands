// Quick-pick asset list shown above the search box.
// Hang Seng Index code format is verified at first call; if Tencent doesn't
// accept "HSI" we'll fall back to whichever form works.

export type Market = "sh" | "sz" | "hk";

export interface QuickSymbol {
  market: Market;
  code: string;
  name: string;
}

export const QUICK_SYMBOLS: QuickSymbol[] = [
  { market: "sh", code: "600519", name: "贵州茅台" },
  { market: "sh", code: "601318", name: "中国平安" },
  { market: "sh", code: "600036", name: "招商银行" },
  { market: "sz", code: "300750", name: "宁德时代" },
  { market: "sz", code: "000858", name: "五粮液" },
  { market: "hk", code: "00700", name: "腾讯控股" },
  { market: "hk", code: "09988", name: "阿里巴巴-W" },
  { market: "hk", code: "03690", name: "美团-W" },
  { market: "hk", code: "00981", name: "中芯国际" },
];

export function symbolKey(market: Market, code: string): string {
  return `${market}${code}`;
}
