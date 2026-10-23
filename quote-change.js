// /api/analysis 的 changePercent 是所选区间涨跌幅，不能当作当日涨跌。
// 当日涨跌一律由最新价与昨收计算；缺少昨收时保留调用方提供的回退值。
export function dailyChangePercent(quote, fallback = 0) {
  const price = Number(quote?.price);
  const previousClose = Number(quote?.previousClose);
  if (!Number.isFinite(price) || !Number.isFinite(previousClose) || previousClose <= 0) return fallback;
  return (price / previousClose - 1) * 100;
}

export function analysisQuoteForStock(analysisData, fallbackChange = 0) {
  return { ...analysisData, changePercent: dailyChangePercent(analysisData, fallbackChange) };
}
