import { selectSignalTimeRange } from "../time-range.js";

function cleanHistory(history) {
  return (Array.isArray(history) ? history : [])
    .map(({ date, value }) => ({ date: String(date || "").slice(0, 10), value: Number(value) }))
    .filter(({ date, value }) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(value));
}

export function classifySentimentPhase(score, impulse) {
  if (score <= 25) {
    return impulse > 0
      ? { id: "panic-stabilizing", label: "恐慌企稳", tone: "positive", summary: "情绪仍在低位，但边际压力已经开始减轻。" }
      : { id: "panic-worsening", label: "恐慌恶化", tone: "negative", summary: "低位情绪继续走弱，尚未形成可靠的反向确认。" };
  }
  if (score >= 75) {
    return impulse < 0
      ? { id: "crowding-deteriorating", label: "拥挤退潮", tone: "negative", summary: "情绪仍高，但动量转弱，需要警惕拥挤交易松动。" }
      : { id: "euphoria-accelerating", label: "狂热加速", tone: "warning", summary: "风险偏好处于高位并继续升温，趋势强但拥挤风险上升。" };
  }
  if (score < 60) {
    return impulse > 0
      ? { id: "neutral-recovery", label: "情绪修复", tone: "positive", summary: "恐慌正在退潮，市场参与度和风险偏好逐步恢复。" }
      : { id: "panic-worsening", label: "谨慎降温", tone: "negative", summary: "情绪位于中低区间且继续转弱，优先观察修复证据。" };
  }
  if (impulse < -3) return { id: "crowding-deteriorating", label: "高位降温", tone: "warning", summary: "风险偏好仍在，但情绪动量已经转弱。" };
  return { id: "healthy-risk-appetite", label: "健康风险偏好", tone: "positive", summary: "情绪位于可持续区间，参与和风险承担保持协调。" };
}

export function getSentimentChartPoint(history, ratio) {
  const points = cleanHistory(history);
  if (!points.length) return null;
  const safeRatio = Math.max(0, Math.min(1, Number(ratio) || 0));
  const index = Math.round(safeRatio * (points.length - 1));
  return { index, ...points[index] };
}

export function summarizeSentimentRange(market, options = {}) {
  const selection = selectSignalTimeRange(cleanHistory(market?.history), options);
  if (!selection.points.length) return null;
  const startValue = selection.points[0].value;
  const endValue = selection.points.at(-1).value;
  const impulse = Number((endValue - startValue).toFixed(2));
  const dimensions = (market?.dimensions || []).map((dimension) => {
    const range = selectSignalTimeRange(cleanHistory(dimension.history), options);
    const fallback = Number.isFinite(Number(dimension.score)) ? Number(dimension.score) : 0;
    const start = range.points[0]?.value ?? fallback;
    const end = range.points.at(-1)?.value ?? fallback;
    return { ...dimension, startScore: start, score: end, change: Number((end - start).toFixed(2)), history: range.points };
  });
  const values = selection.points.map(({ value }) => value);
  return {
    ...selection,
    startValue,
    endValue,
    impulse,
    high: Math.max(...values),
    low: Math.min(...values),
    percentile: Math.round(values.filter((value) => value <= endValue).length / values.length * 100),
    phase: classifySentimentPhase(endValue, impulse),
    dimensions,
  };
}
