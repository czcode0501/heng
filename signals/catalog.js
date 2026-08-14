export const signalDirectories = [
  {
    id: "macro",
    index: "01",
    title: "宏观信号",
    english: "MACRO SIGNALS",
    description: "宏观环境相关信号的独立分析模块。具体指标、数据源与判定规则等待定义。",
  },
  {
    id: "market-timing",
    index: "02",
    title: "市场择时",
    english: "MARKET TIMING",
    description: "中国股票与美国股票独立计算的市场时机分析模块。",
  },
  {
    id: "sector-rotation",
    index: "03",
    title: "板块轮动",
    english: "SECTOR ROTATION",
    description: "行业与板块轮动信号的独立分析模块。具体分类、排序与切换规则等待定义。",
  },
  {
    id: "investor-sentiment",
    index: "04",
    title: "投资者情绪",
    english: "INVESTOR SENTIMENT",
    description: "投资者情绪信号的独立分析模块。具体代理变量与解释规则等待定义。",
  },
  {
    id: "capital-flow",
    index: "05",
    title: "资金流向",
    english: "CAPITAL FLOW",
    description: "资金流向信号的独立分析模块。具体市场范围、口径与周期等待定义。",
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
