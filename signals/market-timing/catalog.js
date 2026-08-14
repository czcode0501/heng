export const marketTimingMarkets = [
  {
    id: "china",
    code: "CN",
    title: "中国股票",
    english: "CHINA EQUITIES",
    scope: "A股",
    primarySource: "BaoStock",
    backupSource: "新浪财经日线",
    dimensions: ["趋势", "市场广度", "成交与流动性", "波动与压力", "风险偏好"],
  },
  {
    id: "united-states",
    code: "US",
    title: "美国股票",
    english: "UNITED STATES EQUITIES",
    scope: "美股",
    primarySource: "yfinance",
    backupSource: "单标的自动重试",
    dimensions: ["趋势", "市场广度", "成交与流动性", "波动与压力", "风险偏好"],
  },
];
