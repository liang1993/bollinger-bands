# 布林带（Bollinger Bands）行情看板技术方案

**版本**：v1.0 · 2026-05-16
**目标读者**：项目实施者（自己或后续接手者）
**项目目录**：`/Users/bytedance/liang/bollinger-bands`（当前为空目录）

---

## 目录

1. [背景与目标](#1-背景与目标)
2. [需求范围（确认）](#2-需求范围确认)
3. [架构总览](#3-架构总览)
4. [数据源调研与选型](#4-数据源调研与选型)
5. [数据存储决策](#5-数据存储决策)
6. [技术栈](#6-技术栈)
7. [接口契约](#7-接口契约)
8. [关键算法：布林带计算](#8-关键算法布林带计算)
9. [前端结构与交互](#9-前端结构与交互)
10. [文件清单](#10-文件清单)
11. [实施计划（带验证）](#11-实施计划带验证)
12. [风险与异常处理](#12-风险与异常处理)
13. [开发期辅助工具 / Skill](#13-开发期辅助工具--skill)
14. [单元测试](#14-单元测试)
15. [范围外（不做的事）](#15-范围外不做的事)

---

## 1. 背景与目标

构建一个网页应用，让用户能：
- 切换不同的 **A股 / 港股** 资产
- 实时看到对应资产的 K 线 + **布林带**（上轨、中轨、下轨）
- 自由调整布林带参数：周期 N、倍数 K、时间区间、K 线粒度

用作个人看盘 / 学习指标行为，不面向多人 / 不做商业化。

---

## 2. 需求范围（确认）

| 维度 | 决定 |
|---|---|
| 资产范围 | A股 / 港股 |
| 应用形态 | Next.js 14 全栈 |
| 图表 | TradingView **Lightweight Charts** |
| 参数 | N（周期）、K（倍数）、时间区间、粒度全部可调 |

---

## 3. 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                       浏览器                                │
│                                                             │
│  page.tsx (URL query 同步状态)                              │
│   ├─ AssetPicker (搜索 + 快捷按钮)                          │
│   ├─ Controls    (粒度 / N / K / range)                     │
│   └─ Chart       (lightweight-charts: K线 + BB 三线)        │
│        ▲                                                    │
│        │ SWR (dedupingInterval: 30s)                        │
└────────┼────────────────────────────────────────────────────┘
         │
         │ /api/kline, /api/search
         ▼
┌─────────────────────────────────────────────────────────────┐
│                Next.js Route Handlers                       │
│           (export const revalidate = 60)                    │
│                                                             │
│   /api/kline   ──► 腾讯财经 (主)                             │
│                  └─ fallback ──► 东方财富 (A股 only)         │
│   /api/search  ──► 东方财富 suggest                          │
└─────────────────────────────────────────────────────────────┘
```

**核心数据流**：URL query → SWR fetch → Route Handler → 上游 → 归一化 → 浏览器
**布林带计算**：客户端，在拿到归一化 candles 后用纯函数算 middle/upper/lower

---

## 4. 数据源调研与选型

### 4.1 候选数据源对比

| 数据源 | A股 | 港股 | Key | 速度 | 选用 |
|---|---|---|---|---|---|
| **腾讯财经** `web.ifzq.gtimg.cn` | ✅ qfq/hfq | ✅ | 不需 | 130-240ms | **主** |
| **东方财富** `push2his.eastmoney.com` | ✅ | ❌ 返回空（实测加 UA/Referer 也不行） | 不需 | ~200ms | A股 fallback |
| 东方财富 suggest `searchadapter.eastmoney.com` | ✅ | ✅ | 内置 token | <200ms | **搜索** |
| AkShare / TuShare | ✅ | ✅ | TuShare 要 token | Python 生态 | ❌ 与 Next.js 不匹配 |
| Yahoo Finance | 部分 | 部分 | 不需 | 慢 | ❌ 国内访问不稳 |

### 4.2 实测验证（已在本次会话完成）

| 测试 | 结果 |
|---|---|
| `sh600519` 日K，请求 320 根 | ✅ 200, 24.5 KB, 170ms |
| `sh600519` 日K，请求 1000 根 | ⚠️ 实际返回 640 根（上游硬截断） |
| `sh600519` 日K，请求 800 根 | ✅ 实际返回 800 根 |
| `sh600519` 日K，请求 3000 根 | ❌ 返回错误（40B） |
| `sh600519` 日K，指定 `from=2010-01-01` | ⚠️ 仍只返回最近 640 根（`from/to` 对历史回溯无效） |
| `sh600519` 周K | ✅ 640 根 ≈ 12 年（2013-至今） |
| `sh600519` 月K | ✅ 297 根 ≈ 25 年（2001-至今全量） |
| `hk00700` 日K，请求 1000 根 | ✅ 实际给到 1000 根 ≈ 4 年 |
| 搜索「茅台」 | ✅ 返回 `600519 / 贵州茅台 / 沪A` |
| 搜索「00700」 | ✅ 返回 `00700 / 腾讯控股 / 港股` |

### 4.3 上游接口规范

#### 4.3.1 腾讯财经 K线
```
GET https://web.ifzq.gtimg.cn/appstock/app/fqkline/get
  ?param={market}{code},{period},{from},{to},{count},{fq}
```
- `market`：`sh` | `sz` | `hk`
- `period`：`day` | `week` | `month` | `m5` | `m15` | `m30` | `m60`
- `fq`：`qfq`（前复权，A股默认）| `hfq` | 空（港股 / 不复权）
- 响应字段路径：`data.{market}{code}.{fqType+period}`，例如 `data.sh600519.qfqday`、`data.hk00700.day`
- 每行数组：`[date, open, close, high, low, volume, ...extra]`（**注意：close 在 high/low 之前**）

#### 4.3.2 东方财富 suggest（搜索）
```
GET https://searchadapter.eastmoney.com/api/suggest/get
  ?input={q}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=10
```
- 响应 `QuotationCodeTable.Data[]`
- `MktNum`：`1`=沪、`0`=深、`116`=港，需映射为腾讯接口的 `sh` / `sz` / `hk`
- 过滤掉 `SecurityTypeName` 不在 `{沪A, 深A, 港股, 创业板, 科创板}` 的项

---

## 5. 数据存储决策

### 5.1 三个候选方案

| 方案 | 成本 | 风险 |
|---|---|---|
| **每次拉取**（推荐） | 0 | 受上游可用性影响；800 根日K 上限 |
| 文件缓存（JSON / SQLite） | 中（增量同步、cron） | 数据陈旧、需要决定盘中是否回源 |
| 完整数仓（Postgres + 后台抓取） | 高 | 个人项目过度设计 |

### 5.2 决策：**不持久化**

**理由**：
- 单次延迟 130-240ms，浏览器 SWR + Next.js `revalidate=60` 后实际感知 < 50ms
- 日K 单次 800 根 = 3 年；周K 12 年；月K 25 年 → 覆盖所有常规看盘场景
- 个人项目 QPS 极低，不会触发上游限流

### 5.3 单次拉取覆盖不到的场景

仅一个：**日K 时间区间超过 3 年**。

应对：UI 把日K range 选项最高设为 3Y，超过则提示「请切换到周K / 月K」。这与 TradingView 免费档行为一致。

### 5.4 何时回头加持久化

出现以下任一情形再考虑（最低成本路径：SQLite 单文件）：
- 真的需要 5 年以上日K 做长周期回测
- 接口被限流（个人使用基本不会）
- 多人共用此站点

### 5.5 缓存策略：动态 revalidate（不引入存储层）

**核心洞察**：上游响应的新鲜度由"最后一根 K 是否还在变"决定，而这又只由当前是否在交易时段决定。

- **盘中**（A股 9:30-11:30 / 13:00-15:00，港股 9:30-12:00 / 13:00-16:00）：最后一根 K 实时变化 → 短 TTL
- **盘后 / 非交易日**：全部 K 闭合 → 长 TTL，下一个交易日开盘前都不变

实现：Route Handler 根据当前时间动态返回 `Cache-Control: public, s-maxage=N`。Next.js 内置 HTTP 缓存层会按 TTL 命中，无需自建文件 / SQLite 存储。

| 层级 | 策略 |
|---|---|
| 浏览器 | SWR `dedupingInterval: 30000`，同参数 30s 内不重发 |
| Next.js Route Handler | **动态 TTL**：盘中 60s、盘后 3600s、非交易日 / 历史日 21600s（6 小时） |
| 上游降级 | 腾讯接口异常时，A股自动切换到东方财富；港股若腾讯异常则展示错误（无替代） |

**实现要点**（`lib/cache-policy.ts`）：

```ts
// 根据 market + 最新 K 的日期 + 当前时间，返回 s-maxage 秒数
export function cacheTTL(market: "sh"|"sz"|"hk", latestKDate: string): number {
  const now = new Date();
  const today = formatYMD(now);
  // 最新 K 不是今天 → 历史，可缓存很久
  if (latestKDate !== today) return 21600;
  // 当前在该 market 的交易时段 → 这根 K 还在变
  if (isMarketOpen(market, now)) return 60;
  // 今天闭市后 → 数据已稳定到明天开盘
  return 3600;
}
```

交易时段判断函数和复用建议：
- 复用 `Intl.DateTimeFormat` 转 `Asia/Shanghai` / `Asia/Hong_Kong` 拿当地时间，避免时区误差
- 周末 / 假日：A股 / 港股的节假日表无 API 可拉。简化处理：只判断**周一到周五 + 当地时段**，节假日的"误标盘中"代价仅是 60s TTL 多打几次源站，可接受
- 该函数纯函数，纳入 `lib/cache-policy.test.ts` 测：交易时段返回 60、盘后返回 3600、周末返回 21600、`latestKDate` 早于今天返回 21600

---

## 6. 技术栈

| 类别 | 选用 | 理由 |
|---|---|---|
| 框架 | **Next.js 14 App Router + TypeScript** | 全栈一体，API route 解决 CORS |
| 样式 | **Tailwind CSS** | 快、零配置 |
| 图表 | **lightweight-charts v5** | 金融行情专用，K线 + 折线叠加性能极好 |
| 数据获取 | **SWR** | 客户端缓存 / 去重 / 失败重试，比手写 fetch 省 |
| 状态 | **URL query**（`useSearchParams`） | 刷新保留参数、可分享 |
| 包管理 | **pnpm** | 与用户其他项目一致 |
| 数据库 | **无** | 见上节 |
| 部署 | 本地 `pnpm dev`，未来可 Vercel | 个人用，先本地跑通 |

---

## 7. 接口契约

### 7.1 `GET /api/kline`

**入参**：
| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `market` | `sh`\|`sz`\|`hk` | ✅ | - | |
| `code` | string | ✅ | - | `600519`、`00700` |
| `period` | `day`\|`week`\|`month`\|`m5`\|`m15`\|`m30`\|`m60` | ❌ | `day` | |
| `fq` | `qfq`\|`hfq`\|`none` | ❌ | A股 `qfq`，港股 `none` | |
| `limit` | int | ❌ | `320` | 上限 800 |

**出参**：
```ts
{
  symbol: "sh600519",
  name: "贵州茅台",
  period: "day",
  fq: "qfq",
  candles: [
    { time: "2026-05-15", open: 1335.15, high: 1339.28, low: 1327.11, close: 1332.95, volume: 58184 },
    ...
  ]
}
```

**错误**：
- 上游 404 / 空数据 → HTTP 404 `{ error: "symbol_not_found" }`
- 上游网络错误且无 fallback → HTTP 502 `{ error: "upstream_unavailable" }`

### 7.2 `GET /api/search`

**入参**：`q`（关键词 / 拼音 / 代码片段）

**出参**：
```ts
[
  { market: "sh", code: "600519", name: "贵州茅台", label: "贵州茅台 (sh600519 沪A)" },
  ...
]
```

---

## 8. 关键算法：布林带计算

**位置**：`lib/indicators.ts`，纯函数，客户端计算。

```ts
export function computeBollinger(
  closes: number[],
  n: number = 20,
  k: number = 2
): { middle: (number | null)[]; upper: (number | null)[]; lower: (number | null)[] }
```

**规则**：
- 前 N-1 个位置返回 `null`，避免图上画错的早期值
- `middle[i] = mean(closes[i-n+1..i])`
- `stddev[i]` 使用**样本标准差**（除以 `n-1`），与 TradingView Pine Script `stdev` 一致
- `upper[i] = middle[i] + k * stddev[i]`，`lower[i] = middle[i] - k * stddev[i]`

**验证方法**：手算前 25 根日K 的 SMA(20) 和样本 stddev，与函数输出比对到小数后 4 位。

---

## 9. 前端结构与交互

### 9.1 URL Query 状态

```
?symbol=sh600519&period=day&fq=qfq&n=20&k=2&range=1Y
```

刷新 / 分享链接都能完整还原。

### 9.2 默认值

- 资产：`sh600519` 贵州茅台
- 周期：日K
- 复权：qfq
- N=20, K=2
- range=1Y

### 9.3 组件

| 组件 | 职责 |
|---|---|
| `AssetPicker` | 搜索框（debounce 300ms）+ 8-12 个常用资产快捷按钮（茅台 / 宁德 / 平安 / 招行 / 腾讯 / 美团 / 阿里港 / 中芯港 / 恒生指数 / 沪深300 …） |
| `Controls` | 粒度 tab（日/周/月/60m/30m/15m/5m）、N 数字输入（5-200）、K 数字输入（0.5-5, 步长 0.1）、range 快捷按钮（1M/3M/6M/1Y/2Y/3Y） |
| `Chart` | 单 `lightweight-charts` 实例，candlestick + 3 条 line series；数据变化时只 `setData`，不重建 chart |

### 9.4 交互细节

- 搜索结果点选后立即触发图表切换
- 改 N / K 不重新拉数据，只重算指标
- 改 period / range / symbol 会触发新 fetch
- Loading 用骨架屏 / 顶部进度条，不闪屏
- 移动端 viewport 适配（chart 自适应宽度）

---

## 10. 文件清单

```
bollinger-bands/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                 # 主页 (client component)
│   └── api/
│       ├── kline/route.ts       # K线代理
│       └── search/route.ts      # 搜索代理
├── components/
│   ├── Chart.tsx                # lightweight-charts 封装 (client only, dynamic import)
│   ├── AssetPicker.tsx
│   └── Controls.tsx
├── lib/
│   ├── datasource.ts            # 上游响应 → 归一化, 含腾讯 / 东财 / fallback
│   ├── indicators.ts            # computeBollinger
│   └── symbols.ts               # 常用资产快捷列表
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── CLAUDE.md                    # 项目级 AI 协作约定（首版完成后用 init skill 生成）
```

---

## 11. 实施计划（带验证）

每步都有可独立验证的产出，避免后期一次性 debug。

| # | 步骤 | 验证 |
|---|---|---|
| 1 | `pnpm create next-app`（TS、Tailwind、App Router、不要 `src/`） | 默认页能 `pnpm dev` 起来 |
| 2 | 装 `lightweight-charts swr` | `pnpm ls` 看到两个包 |
| 3 | 写 `lib/datasource.ts` + `app/api/kline/route.ts` | `curl 'localhost:3000/api/kline?market=sh&code=600519&period=day&limit=5'` 返 5 根；港股 `market=hk&code=00700` 也通 |
| 4 | 写 `lib/indicators.ts` | 手算 5 个数的 SMA 和样本 stddev 对齐函数输出（写一个最小 Node 脚本跑一次也行） |
| 5 | 写最小 `Chart.tsx` + `page.tsx`，硬编码茅台 + BB(20,2) | 浏览器看到 K线 + 三条 BB 线，BB 第 20 根之后才出现（前面是 null） |
| 6 | 加 `Controls.tsx`，N / K / period / range 可调，URL query 同步 | 改 N=10 K=2.5 → 通道立刻变窄；切到周K → K线密度变化 |
| 7 | 写 `app/api/search/route.ts` + `AssetPicker.tsx` | 搜「茅台」「腾讯」「00700」「600036」均能切到对应资产 |
| 8 | 快捷资产按钮、loading 态、错误态、移动端样式 | 关掉网络看到错误提示而不是白屏；手机宽度图表不溢出 |
| 9 | （可选）用 `anthropic-skills:simplify` 跑一遍 | 砍掉冗余逻辑 |
| 10 | 用 `init` skill 生成 `CLAUDE.md` | 后续 session 拾起更快 |

---

## 12. 风险与异常处理

| 风险 | 概率 | 影响 | 应对 |
|---|---|---|---|
| 腾讯接口短期不稳 | 低 | A股 / 港股都拉不到 | A股切换东财；港股仅展示错误并保留上次数据 |
| 上游接口字段变更 | 极低 | 解析失败 | datasource 层有 schema 校验，失败时记日志 + 友好提示 |
| 用户输入超长 range | 中 | 数据被截断、BB 算出但前面缺 N-1 个点 | UI 强制 range 在合理范围；前 N-1 个 BB 返 null 而非崩溃 |
| 浏览器禁用 JS / 老 Safari | 低 | 整站不可用 | 接受（个人项目） |
| 上游对单 IP 限流 | 极低 | 短时间 429 | SWR 重试一次后展示错误，30s 后自动恢复（next revalidate 触发新拉） |
| `lightweight-charts` v5 API 不熟 | 中 | 折腾时间 | 第 5 步先做最小可跑版本，再叠加 BB |

---

## 13. 开发期辅助工具 / Skill

### 13.1 强相关（建议主动用）

| 工具 | 触发点 |
|---|---|
| **Claude Preview MCP** `mcp__Claude_Preview__*` | 写完 `Chart.tsx` 第一版后立刻预览；改 N/K 后看图重绘 |
| **LSP**（deferred） | 编辑 `lib/datasource.ts`、`Chart.tsx` 时实时看类型错误，比 `tsc --noEmit` 快 |
| **anthropic-skills:simplify** | 每写完一个模块（datasource / indicators / Chart）跑一次 |
| **Chrome MCP** `mcp__Claude_in_Chrome__*` | E2E：模拟搜「腾讯」→ 选 00700 → 改 N=50 → 检查 BB 重绘 |
| **init** skill | 首版能跑后立刻生成 `CLAUDE.md` |

### 13.2 弱相关（看情况）

- `fewer-permission-prompts`：高频只读命令进 allowlist
- `lark-doc` / `lark-im`：未来想把图表 / 分析结果发飞书时启用

### 13.3 明确不用

飞书其余（calendar / minutes / approval / okr ）、`xlsx / pdf / pptx / docx`、`loop / schedule / scheduled-tasks`、`asr / media-fetch`、`claude-api`、`skill-creator`、`security-review`（本项目攻击面极小）。

---

## 14. 单元测试

### 14.1 范围与原则

只测两类，其它一律不写：

1. **纯函数 / 数据归一化**——逻辑确定、易回归、性价比高
2. **历史已踩坑的契约**——拒绝再踩第二次

UI 组件、Chart 实例、API 路由集成都不写单测，靠 Claude Preview + Chrome MCP 人工 E2E 看图验证。不追覆盖率指标，目标是「**改坏关键逻辑时会失败**」。

### 14.2 测试栈

- **Vitest** + `tsx` —— Next.js 14 / TS 友好，零配置 ESM，比 Jest 启动快几倍
- 单个文件：`pnpm vitest run lib/indicators.test.ts`
- watch 模式：`pnpm vitest`
- 不引 `jsdom` / `@testing-library/react`（不测组件）

`package.json` 追加：
```jsonc
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vitest": "^2",
    "@types/node": "^20"
  }
}
```

### 14.3 必写用例清单

#### `lib/indicators.test.ts`（核心）

| 用例 | 断言 |
|---|---|
| `computeBollinger` 前 N-1 项为 `null` | `result.middle.slice(0, n-1).every(v => v === null)` |
| SMA 计算正确 | 给 `[1,2,3,4,5]`, N=3 → `middle[2] === 2`, `middle[3] === 3`, `middle[4] === 4` |
| 使用**样本** stddev（除以 N-1） | 给 `[2,4,4,4,5,5,7,9]`, N=8 → stddev ≈ 2.138（除以 7），而非 2.0（除以 8） |
| K 倍数生效 | 同上数据 K=2 → `upper - middle === 2 * stddev` 到小数后 6 位 |
| 输入长度 < N | 全部返回 `null`，不抛异常 |
| 与 TradingView 已知参考值对齐 | 取 5-10 个手算或截图自 TV 的样本（注释里写来源），断言到小数后 4 位 |

#### `lib/datasource.test.ts`（防 close 位置坑）

把一个**真实的腾讯响应 JSON 片段**冻进测试 fixture（直接 curl 一次粘进来），断言：

| 用例 | 断言 |
|---|---|
| 解析 A股 `qfqday` 路径 | 拿 `data.sh600519.qfqday` 而非 `data.sh600519.day` |
| 解析港股 `day` 路径（无 qfq 前缀） | 拿 `data.hk00700.day` |
| **字段顺序：close 在位置 2** | 给 `["2026-05-15","1335.15","1332.95","1339.28","1327.11","58184"]` → `{open:1335.15, close:1332.95, high:1339.28, low:1327.11}` |
| volume 转为 number | 不是字符串 |
| 上游空 candles 数组 | 返回 `[]` 而非抛异常 |
| 东方财富 `MktNum` 映射 | `116 → "hk"`, `1 → "sh"`, `0 → "sz"` |

#### `lib/cache-policy.test.ts`（防时段判断错误）

| 用例 | 断言 |
|---|---|
| A股盘中（周二 10:00 Shanghai） | `cacheTTL("sh", today) === 60` |
| A股盘后（周二 16:00 Shanghai） | `cacheTTL("sh", today) === 3600` |
| 港股盘中（周二 14:00 HK） | `cacheTTL("hk", today) === 60` |
| 周六 | `cacheTTL("sh", today) === 21600` |
| `latestKDate` 早于今天（休市 / 历史响应） | 返回 21600 |
| 时区跨界（UTC 1:30 = Shanghai 9:30） | 正确识别为盘中 |

测试中用 `vi.useFakeTimers()` + `vi.setSystemTime()` 冻结时间，避免依赖运行时刻。

### 14.4 不写的测试

- `Chart.tsx`、`AssetPicker.tsx`、`Controls.tsx` 等组件——`lightweight-charts` 在 jsdom 下行为不稳定，且核心逻辑都已抽到 `lib/*` 测过
- API route handler——薄壳，调用 `lib/datasource.ts`，已被间接覆盖；上游 mock 的脆弱性大于收益
- URL query 同步逻辑——靠 E2E 看页面，单测难做且容易过拟合

### 14.5 实施时机

放在 `DESIGN.md §11` 实施计划的第 4 步之后立刻补上对应的 `indicators.test.ts`，第 3 步之后补 `datasource.test.ts`。在每次提交前跑 `pnpm test` 确保绿。

---

## 15. 范围外（不做的事）

- **不持久化任何 K线数据**（见 §5）
- 不做用户系统 / 服务端收藏夹（URL query 已能分享）
- 不做美股 / 加密 / 多指标组合（用户当前没提）
- 不做实时推送（盘中 1 分钟回源足够）
- 不做 Docker / CI（本地 `pnpm dev` 跑通即交付）
- 不追单测覆盖率指标，只写 §14 列出的高价值用例

---

## 附录 A：常用资产快捷列表（初始）

```ts
// lib/symbols.ts
export const QUICK_SYMBOLS = [
  { market: "sh", code: "600519", name: "贵州茅台" },
  { market: "sh", code: "601318", name: "中国平安" },
  { market: "sh", code: "600036", name: "招商银行" },
  { market: "sz", code: "300750", name: "宁德时代" },
  { market: "sz", code: "000858", name: "五粮液" },
  { market: "hk", code: "00700", name: "腾讯控股" },
  { market: "hk", code: "09988", name: "阿里巴巴-W" },
  { market: "hk", code: "03690", name: "美团-W" },
  { market: "hk", code: "00981", name: "中芯国际" },
  { market: "sh", code: "000300", name: "沪深300（指数）" },
  { market: "hk", code: "HSI",    name: "恒生指数" },
];
```

恒生指数的代码格式需要在实施第 3 步时实测确认（可能要带 `.HK` 后缀，腾讯接口的指数代码规则与个股略不同）。
