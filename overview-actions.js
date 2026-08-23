function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(Math.max(0, finite(value)));
}

function brokerPresentation(broker = {}) {
  const positionCount = Math.max(0, Math.round(finite(broker.positionCount)));
  if (broker.state === "ready") {
    return {
      state: "ready",
      label: `券商真实账户已连接 · ${positionCount} 个持仓`,
      detail: "IBKR 只读同步正常；账户、现金与持仓以券商返回为准。",
    };
  }
  if (broker.state === "cached") {
    return {
      state: "cached",
      label: `券商连接待恢复 · 保留 ${positionCount} 个持仓`,
      detail: "当前显示上次成功快照；入口不会消失，也不会改成模拟持仓。",
    };
  }
  if (broker.state === "unavailable") {
    return {
      state: "unavailable",
      label: "券商连接待恢复",
      detail: broker.message || "真实账户工作区已保留；恢复 TWS / IB Gateway 后可继续同步。",
    };
  }
  return {
    state: "not-configured",
    label: "尚未接入券商",
    detail: "可接入 IBKR 或 QMT，只读同步真实账户、现金与持仓，不在本软件内下单。",
  };
}

function toneForRisk(label = "") {
  if (/高仓位|偏高/.test(label)) return "negative";
  if (/偏低/.test(label)) return "caution";
  return "neutral";
}

export function buildOverviewActionModel(options = {}) {
  const broker = brokerPresentation(options.broker);
  if (options.mode === "broker") {
    const current = finite(options.broker?.currentExposurePct);
    const target = finite(options.broker?.targetExposurePct, 50);
    const riskLabel = options.broker?.riskLabel || "等待仓位评估";
    const connected = ["ready", "cached"].includes(broker.state);
    return {
      mode: "broker",
      sourceLabel: "IBKR 只读真实账户",
      action: connected ? "优先复核真实持仓" : "恢复券商连接",
      actionDetail: connected
        ? `当前仓位 ${current.toFixed(1)}%，模型目标 ${target.toFixed(0)}%；${options.broker?.riskDetail || "逐只检查持仓与风险边界"}。`
        : broker.detail,
      tone: connected ? toneForRisk(riskLabel) : "caution",
      currentExposurePct: current,
      targetExposurePct: target,
      adjustmentAmount: null,
      positionCount: Math.max(0, Math.round(finite(options.broker?.positionCount))),
      riskLabel,
      broker,
    };
  }

  const positionCount = Math.max(0, Math.round(finite(options.positionCount)));
  const investedValue = Math.max(0, finite(options.investedValue));
  const totalValue = Math.max(0, finite(options.totalValue));
  const cash = Math.max(0, finite(options.cash));
  const current = totalValue > 0 ? investedValue / totalValue * 100 : 0;
  const target = finite(options.targetExposurePct, 50);
  const gap = current - target;
  let action = "先研究，再建仓";
  let actionDetail = "先搜索股票，查看明确的买入区、等待条件、卖出区和判断失效位。";
  let tone = "neutral";
  let adjustmentAmount = 0;

  if (positionCount > 0 && gap >= 8) {
    adjustmentAmount = totalValue * gap / 100;
    action = "优先降低仓位";
    actionDetail = `${options.riskDetail || "当前仓位高于模型目标"}；按当前组合规模，约 ${money(adjustmentAmount)} 需要降低。`;
    tone = "negative";
  } else if (positionCount > 0 && gap <= -15) {
    adjustmentAmount = Math.min(cash, totalValue * Math.abs(gap) / 100);
    action = "还有建仓空间";
    actionDetail = adjustmentAmount > 0
      ? `最多先从可用现金中安排约 ${money(adjustmentAmount)}，仍需逐只通过个股买入条件。`
      : "目标仓位高于当前仓位；先补充现金余额，再逐只通过个股买入条件。";
    tone = "caution";
  } else if (positionCount > 0) {
    action = "维持仓位，逐只复核";
    actionDetail = `${options.riskDetail || "当前仓位接近模型目标"}；优先检查持仓的卖出区和判断失效位。`;
  }

  return {
    mode: "custom",
    sourceLabel: `${options.portfolioName || "自建组合"} · 本机研究组合`,
    action,
    actionDetail,
    tone,
    currentExposurePct: current,
    targetExposurePct: target,
    adjustmentAmount,
    positionCount,
    riskLabel: positionCount ? options.riskLabel || "等待仓位评估" : "尚未建仓",
    broker,
  };
}

export function renderOverviewActionPanel(model) {
  const brokerTone = model.broker.state === "ready" ? "ready" : model.broker.state === "cached" ? "cached" : "pending";
  const exposure = model.positionCount
    ? `<span>当前仓位 <strong>${model.currentExposurePct.toFixed(1)}%</strong></span><span>目标仓位 <strong>${model.targetExposurePct.toFixed(0)}%</strong></span>`
    : '<span>当前状态 <strong>尚未建立持仓</strong></span>';
  return `<div class="today-action-heading">
    <div><p class="eyebrow">TODAY · TRADING WORKBENCH</p><h2>今日交易工作台</h2><p>${escapeHtml(model.sourceLabel)}</p></div>
    <span class="today-source-badge">研究辅助 · 不自动下单</span>
  </div>
  <div class="today-action-grid">
    <article class="today-primary-action is-${escapeHtml(model.tone)}">
      <span>现在怎么做</span>
      <strong>${escapeHtml(model.action)}</strong>
      <p>${escapeHtml(model.actionDetail)}</p>
      <div>${exposure}<span>风险状态 <strong>${escapeHtml(model.riskLabel)}</strong></span></div>
    </article>
    <div class="today-task-list">
      <article><span>01 · 找机会</span><strong>先分析，再决定买不买</strong><p>搜索A股或美股，系统会给出当前动作、条件买入区、卖出区和失效位。</p><button class="text-link" type="button" data-focus-stock-search>搜索股票 →</button></article>
      <article><span>02 · 管持仓</span><strong>${model.positionCount ? `${model.positionCount} 个持仓等待复核` : "先建立真实或自建持仓"}</strong><p>持仓操作以仓位偏差、集中度和每只股票的风险边界为准。</p><button class="text-link" type="button" data-scroll-holdings>查看持仓 →</button></article>
      <article class="today-broker-task is-${brokerTone}"><span>03 · 券商账户</span><strong>${escapeHtml(model.broker.label)}</strong><p>${escapeHtml(model.broker.detail)}</p><a class="text-link" href="#data-sources">管理真实账户 →</a></article>
    </div>
  </div>
  <p class="today-action-boundary"><strong>买什么：</strong>方法论观察池不是买入清单；只有个股完成行情、公司事实和风险闸门后，才会显示“买入”。<strong>暂不参与：</strong>数据不足会单列为未知，不会伪装成负面判断。</p>`;
}
