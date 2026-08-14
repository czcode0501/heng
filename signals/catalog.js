export const signalDirectories = [
  {
    id: "macro",
    index: "01",
    title: "宏观信号",
    english: "MACRO SIGNALS",
    description: "宏观环境相关信号的独立分析模块。具体指标、数据源与判定规则等待定义。",
    status: "自动更新 · 后台预载",
  },
  {
    id: "market-timing",
    index: "02",
    title: "市场择时",
    english: "MARKET TIMING",
    description: "中国股票与美国股票独立计算的市场时机分析模块。",
    status: "自动更新 · 后台预载",
  },
  {
    id: "sector-rotation",
    index: "03",
    title: "板块轮动",
    english: "SECTOR ROTATION",
    description: "中国与美国市场独立排名，把趋势、相对强弱、资金确认与风险转化为轮动阶段。",
    status: "自动更新 · 后台预载",
  },
  {
    id: "investor-sentiment",
    index: "04",
    title: "投资者情绪",
    english: "INVESTOR SENTIMENT",
    description: "投资者情绪信号的独立分析模块。具体代理变量与解释规则等待定义。",
    status: "等待定义",
  },
  {
    id: "capital-flow",
    index: "05",
    title: "资金流向",
    english: "CAPITAL FLOW",
    description: "用九项价格—成交量证据观察中美板块的流入、流出、持续性与价量背离。",
    status: "自动更新 · 后台预载",
  },
];

export function resolveWorkspaceRoute(hash = "") {
  const route = hash.replace(/^#/, "").replace(/\/$/, "");
  if (route === "signals") return { workspace: "signals", directory: null };
  if (route.startsWith("signals/")) {
    const directory = route.slice("signals/".length);
    const isKnownDirectory = signalDirectories.some((item) => item.id === directory);
    return { workspace: "signals", directory: isKnownDirectory ? directory : null };
  }
  return { workspace: "overview", directory: null };
}
