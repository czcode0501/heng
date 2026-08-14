export function getSearchResultActions(portfolio, stock) {
  const isHeld = portfolio.positions.some((position) => position.symbol === stock.symbol);
  return {
    canViewAnalysis: true,
    canAdd: !isHeld,
    addLabel: isHeld ? "已持有" : "添加",
  };
}

const trendPresentations = {
  strong_up: {
    label: "趋势偏强",
    tone: "positive",
    summary: "价格位于20日与60日均线上方，短中期趋势保持正向。",
  },
  up: {
    label: "短期偏强",
    tone: "positive",
    summary: "价格位于20日均线上方，短期动能较强，仍需观察中期趋势确认。",
  },
  neutral: {
    label: "趋势中性",
    tone: "neutral",
    summary: "价格围绕主要均线运行，暂未形成清晰的趋势方向。",
  },
  down: {
    label: "短期偏弱",
    tone: "negative",
    summary: "价格位于20日均线下方，短期走势偏弱，应关注企稳信号。",
  },
  strong_down: {
    label: "趋势偏弱",
    tone: "negative",
    summary: "价格位于20日与60日均线下方，短中期趋势仍承受压力。",
  },
};

export function getTrendPresentation(trend) {
  return trendPresentations[trend] || trendPresentations.neutral;
}
