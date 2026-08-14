export const SIGNAL_TIME_RANGES = [
  { id: "1d", label: "1日" },
  { id: "1w", label: "1周" },
  { id: "1m", label: "1月" },
  { id: "3m", label: "3月" },
  { id: "1y", label: "1年" },
  { id: "custom", label: "自定义起点" },
];

const VALID_IDS = new Set(SIGNAL_TIME_RANGES.map(({ id }) => id));

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function isoDate(value) {
  const text = String(value || "");
  if (/^\d{4}-\d{2}$/.test(text)) return `${text}-01`;
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : "";
}

function shiftedStart(latestDate, range) {
  const date = new Date(`${latestDate}T00:00:00Z`);
  if (range === "1w") date.setUTCDate(date.getUTCDate() - 7);
  if (range === "1m") date.setUTCMonth(date.getUTCMonth() - 1);
  if (range === "3m") date.setUTCMonth(date.getUTCMonth() - 3);
  if (range === "1y") date.setUTCFullYear(date.getUTCFullYear() - 1);
  return date.toISOString().slice(0, 10);
}

export function normalizeSignalTimeRange(range) {
  return VALID_IDS.has(range) ? range : "1m";
}

export function selectSignalTimeRange(history, options = {}) {
  const points = (Array.isArray(history) ? history : [])
    .map((point) => ({ ...point, date: String(point.date || "").slice(0, 10), _date: isoDate(point.date) }))
    .filter(({ _date, value }) => _date && Number.isFinite(Number(value)))
    .sort((left, right) => left._date.localeCompare(right._date));
  if (!points.length) return { range: normalizeSignalTimeRange(options.range), points: [], observations: 0 };

  const range = normalizeSignalTimeRange(options.range);
  const latest = points.at(-1);
  let startIndex = 0;
  if (range === "1d") {
    startIndex = Math.max(0, points.length - 2);
  } else {
    const requested = range === "custom" && isoDate(options.customStart)
      ? isoDate(options.customStart)
      : shiftedStart(latest._date, range === "custom" ? "1m" : range);
    const found = points.findIndex(({ _date }) => _date >= requested);
    startIndex = found < 0 ? points.length - 1 : found;
    if (startIndex === points.length - 1 && points.length > 1) startIndex -= 1;
  }
  const selected = points.slice(startIndex).map(({ _date, ...point }) => point);
  return {
    range,
    startDate: selected[0]?.date,
    endDate: selected.at(-1)?.date,
    observations: selected.length,
    points: selected,
  };
}

export function signalTimeRangeLabel(range, customStart = "") {
  if (range === "custom") return `自定义 · ${customStart || "选择起点"}`;
  return SIGNAL_TIME_RANGES.find(({ id }) => id === range)?.label || "1月";
}

export function renderSignalTimeRangeControl({ range = "1m", customStart = "", scope = "signals", minimum = "", maximum = "" } = {}) {
  const selected = normalizeSignalTimeRange(range);
  const latestAllowed = maximum || new Date().toISOString().slice(0, 10);
  return `<section class="signal-time-range" data-signal-scope="${escapeHtml(scope)}" aria-label="统一时间范围">
    <div><span>PERFORMANCE WINDOW</span><strong>选择对比时间</strong><small>从所选起点的首个有效观察值与最新数据比较。</small></div>
    <div class="signal-time-range-actions"><div class="signal-time-range-presets" role="group" aria-label="选择时间范围">
      ${SIGNAL_TIME_RANGES.filter(({ id }) => id !== "custom").map(({ id, label }) => `<button type="button" data-signal-range="${id}" data-signal-scope="${escapeHtml(scope)}" aria-pressed="${selected === id}">${label}</button>`).join("")}
    </div><label><span>自定义起点</span><input type="date" ${minimum ? `min="${escapeHtml(minimum)}"` : ""} max="${escapeHtml(latestAllowed)}" value="${escapeHtml(customStart)}" data-signal-custom-start data-signal-scope="${escapeHtml(scope)}"></label></div>
  </section>`;
}
