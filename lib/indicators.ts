// Bollinger Bands.
// DESIGN.md §8: use *sample* stddev (divide by N-1) to match TradingView's
// Pine Script `stdev`. Returning null for the first N-1 positions avoids
// drawing meaningless ramp-up bands.

export interface BollingerBands {
  middle: (number | null)[];
  upper: (number | null)[];
  lower: (number | null)[];
}

export function computeBollinger(
  closes: number[],
  n: number = 20,
  k: number = 2,
): BollingerBands {
  const len = closes.length;
  const middle: (number | null)[] = new Array(len).fill(null);
  const upper: (number | null)[] = new Array(len).fill(null);
  const lower: (number | null)[] = new Array(len).fill(null);

  if (n <= 1 || len < n) return { middle, upper, lower };

  // Rolling sum for the mean.
  let sum = 0;
  for (let i = 0; i < n; i++) sum += closes[i];

  for (let i = n - 1; i < len; i++) {
    if (i >= n) sum += closes[i] - closes[i - n];
    const mean = sum / n;

    // Sample variance: divide by (n - 1).
    let sqSum = 0;
    for (let j = i - n + 1; j <= i; j++) {
      const d = closes[j] - mean;
      sqSum += d * d;
    }
    const std = Math.sqrt(sqSum / (n - 1));

    middle[i] = mean;
    upper[i] = mean + k * std;
    lower[i] = mean - k * std;
  }

  return { middle, upper, lower };
}
