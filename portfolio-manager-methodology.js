import { resolvePortfolioManager } from "./portfolio-managers.js";

export const SECTOR_LABELS = Object.freeze({
  "information-technology": "信息技术",
  "consumer-staples": "日常消费",
  "consumer-discretionary": "可选消费",
  financials: "金融",
  "health-care": "医疗保健",
  industrials: "工业",
  utilities: "公用事业",
  energy: "能源",
  materials: "原材料",
});

const SECTOR_EXAMPLES = Object.freeze({
  "information-technology": {
    china: { symbol: "588170", name: "华夏上证科创板半导体材料设备主题ETF" },
    "united-states": { symbol: "XLK", name: "State Street® Technology Select Sector SPDR® ETF" },
  },
  "consumer-staples": {
    china: { symbol: "600519", name: "贵州茅台" },
    "united-states": { symbol: "XLP", name: "State Street® Consumer Staples Select Sector SPDR® ETF" },
  },
  "consumer-discretionary": {
    china: { symbol: "000333", name: "美的集团" },
    "united-states": { symbol: "XLY", name: "State Street® Consumer Discretionary Select Sector SPDR® ETF" },
  },
  financials: {
    china: { symbol: "000001", name: "平安银行" },
    "united-states": { symbol: "XLF", name: "State Street® Financial Select Sector SPDR® ETF" },
  },
  "health-care": {
    china: { symbol: "600276", name: "恒瑞医药" },
    "united-states": { symbol: "XLV", name: "State Street® Health Care Select Sector SPDR® ETF" },
  },
  industrials: {
    china: { symbol: "512660", name: "国泰中证军工ETF" },
    "united-states": { symbol: "XLI", name: "State Street® Industrial Select Sector SPDR® ETF" },
  },
  utilities: {
    china: { symbol: "159611", name: "广发中证全指电力ETF" },
    "united-states": { symbol: "XLU", name: "State Street® Utilities Select Sector SPDR® ETF" },
  },
  energy: {
    china: { symbol: "600938", name: "中国海油" },
    "united-states": { symbol: "XLE", name: "State Street® Energy Select Sector SPDR® ETF" },
  },
  materials: {
    china: { symbol: "512400", name: "南方中证申万有色金属ETF" },
    "united-states": { symbol: "XLB", name: "State Street® Materials Select Sector SPDR® ETF" },
  },
});

const MANAGER_LENSES = Object.freeze({
  "quant-balanced": {
    signature: "让多维证据共同投票",
    preferredSectorIds: ["information-technology", "health-care", "industrials"],
    sectorRationale: "优先跟踪趋势、质量与资金共振的板块",
    watchlists: { china: [["588170", "华夏上证科创板半导体材料设备主题ETF"], ["510300", "华泰柏瑞沪深300ETF"], ["512660", "国泰中证军工ETF"]], "united-states": [["MSFT", "Microsoft Corporation"], ["SPY", "SPDR® S&P 500® ETF Trust"], ["XLV", "State Street® Health Care Select Sector SPDR® ETF"]] },
    macroHeadline: "多因子环境评分", positiveVerdict: "多因子共振", watchVerdict: "证据分化", negativeVerdict: "信号转弱",
    advice: "按宏观、择时、板块与价格证据的覆盖度调整权重，不让单一信号决定仓位。",
  },
  buffett: {
    signature: "好生意、好管理、好价格",
    preferredSectorIds: ["consumer-staples", "financials", "information-technology"],
    sectorRationale: "偏好品牌、客户黏性、低资本消耗与长期定价权",
    watchlists: { china: [["600519", "贵州茅台"], ["000001", "平安银行"], ["600887", "内蒙古伊利实业集团股份有限公司"]], "united-states": [["AAPL", "Apple Inc."], ["KO", "The Coca-Cola Company"], ["AXP", "American Express Company"]] },
    macroHeadline: "先看企业韧性，不追宏观预测", positiveVerdict: "质量持有候选", watchVerdict: "等待估值核验", negativeVerdict: "能力圈外复核",
    advice: "重点核验护城河、所有者收益和估值安全边际；短期涨跌不单独构成买卖理由。",
  },
  munger: {
    signature: "先排除永久损失，再集中于少数优质企业",
    preferredSectorIds: ["consumer-staples", "industrials", "health-care"],
    sectorRationale: "偏好激励清晰、规模优势可持续且不依赖高杠杆的生意",
    watchlists: { china: [["600519", "贵州茅台"], ["600276", "恒瑞医药"], ["000333", "美的集团"]], "united-states": [["MSFT", "Microsoft Corporation"], ["COST", "Costco Wholesale Corporation"], ["GOOGL", "Alphabet Inc. Class A"]] },
    macroHeadline: "逆向检查环境中的脆弱点", positiveVerdict: "高质量集中候选", watchVerdict: "逆向清单待核验", negativeVerdict: "永久损失风险",
    advice: "先问哪些假设会让这笔投资失败，再核验激励、杠杆和竞争优势是否经得住周期。",
  },
  graham: {
    signature: "价格必须显著低于保守价值",
    preferredSectorIds: ["financials", "utilities", "materials"],
    sectorRationale: "偏好资产与盈利较易验证、可用折价建立安全边际的板块",
    watchlists: { china: [["000001", "平安银行"], ["600900", "中国长江电力股份有限公司"], ["600019", "宝山钢铁股份有限公司"]], "united-states": [["BRK.B", "Berkshire Hathaway Inc. Class B"], ["JPM", "JPMorgan Chase & Co."], ["DUK", "Duke Energy Corporation"]] },
    macroHeadline: "用悲观情景检验安全边际", positiveVerdict: "折价候选", watchVerdict: "价值证据不足", negativeVerdict: "无安全边际",
    advice: "用资产负债表和标准化盈利估算保守价值；没有足够折价时，即使价格上涨也继续等待。",
  },
  lynch: {
    signature: "增长故事必须能被财务事实验证",
    preferredSectorIds: ["consumer-discretionary", "information-technology", "health-care"],
    sectorRationale: "从可理解的消费变化与成长赛道中寻找盈利加速",
    watchlists: { china: [["300750", "宁德时代"], ["002594", "比亚迪股份有限公司"], ["300760", "深圳迈瑞生物医疗电子股份有限公司"]], "united-states": [["TSLA", "Tesla, Inc."], ["NVDA", "NVIDIA Corporation"], ["AMZN", "Amazon.com, Inc."]] },
    macroHeadline: "寻找仍在加速的盈利故事", positiveVerdict: "成长故事成立", watchVerdict: "核对增长事实", negativeVerdict: "故事与数字背离",
    advice: "把公司归入成长类型，并持续核对收入、利润和估值；板块热度不能替代盈利兑现。",
  },
  marks: {
    signature: "先测量周期温度，再决定进攻还是防守",
    preferredSectorIds: ["financials", "utilities", "energy"],
    sectorRationale: "优先观察风险溢价、信用条件和被市场冷落的防守方向",
    watchlists: { china: [["000001", "平安银行"], ["510050", "华夏上证50ETF"], ["159611", "广发中证全指电力ETF"]], "united-states": [["HYG", "iShares iBoxx $ High Yield Corporate Bond ETF"], ["XLU", "State Street® Utilities Select Sector SPDR® ETF"], ["XLE", "State Street® Energy Select Sector SPDR® ETF"]] },
    macroHeadline: "周期温度与风险定价", positiveVerdict: "赔率尚可", watchVerdict: "周期降温观察", negativeVerdict: "风险补偿不足",
    advice: "比较潜在回报与下行风险，控制拥挤板块和高仓位；盈利不代表风险已经被充分定价。",
  },
  dalio: {
    signature: "不押单一宏观情景，以风险预算实现分散",
    preferredSectorIds: ["industrials", "materials", "energy"],
    sectorRationale: "用增长与通胀敏感资产的组合降低单一路径依赖",
    watchlists: { china: [["510300", "华泰柏瑞沪深300ETF"], ["512400", "南方中证申万有色金属ETF"], ["159611", "广发中证全指电力ETF"]], "united-states": [["SPY", "SPDR® S&P 500® ETF Trust"], ["TLT", "iShares 20+ Year Treasury Bond ETF"], ["GLD", "SPDR® Gold Shares"]] },
    macroHeadline: "增长、通胀与政策组合", positiveVerdict: "风险贡献可接受", watchVerdict: "分散度待改善", negativeVerdict: "单一情景暴露",
    advice: "检查该持仓对增长、通胀和流动性的敏感度，并与其他风险来源平衡，不按股票数量假装分散。",
  },
  soros: {
    signature: "跟踪叙事、价格与资金的反馈回路",
    preferredSectorIds: ["information-technology", "consumer-discretionary", "financials"],
    sectorRationale: "偏好价格趋势和资金反馈已形成、且可快速纠错的方向",
    watchlists: { china: [["588170", "华夏上证科创板半导体材料设备主题ETF"], ["159915", "易方达创业板ETF"], ["300750", "宁德时代"]], "united-states": [["NVDA", "NVIDIA Corporation"], ["TSLA", "Tesla, Inc."], ["QQQ", "Invesco QQQ Trust, Series 1"]] },
    macroHeadline: "反馈回路是否正在自我强化", positiveVerdict: "趋势参与", watchVerdict: "反馈待确认", negativeVerdict: "止损复核",
    advice: "顺势时允许参与，但要预先定义错误条件；趋势、资金或叙事任一断裂时快速缩小试错仓。",
  },
});

export function managerLens(managerId) {
  return MANAGER_LENSES[managerId] || MANAGER_LENSES["quant-balanced"];
}

export function sectorExample(sectorId, marketId) {
  return SECTOR_EXAMPLES[sectorId]?.[marketId] || null;
}

export function managerSectorPreference(managerId, sectorId, marketId = "united-states") {
  const manager = resolvePortfolioManager(managerId);
  const lens = managerLens(manager.id);
  const sectorLabel = SECTOR_LABELS[sectorId] || "行业待识别";
  const preferred = sectorId ? lens.preferredSectorIds.includes(sectorId) : null;
  const label = preferred == null
    ? `${manager.name}：行业尚未识别`
    : preferred
      ? `符合${manager.name}方法论优先研究行业 · ${sectorLabel}`
      : `不在${manager.name}方法论优先研究行业 · ${sectorLabel}`;
  return {
    preferred,
    label,
    sectorId: sectorId || null,
    sectorLabel,
    marketId,
    marketLabel: marketId === "china" ? "A股" : "美股",
    example: sectorExample(sectorId, marketId),
    rationale: lens.sectorRationale,
  };
}
