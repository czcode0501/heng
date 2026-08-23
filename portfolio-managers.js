export const DEFAULT_PORTFOLIO_MANAGER_ID = "quant-balanced";

export const CAPABILITY_LABELS = Object.freeze({
  macro: "宏观周期",
  timing: "市场择时",
  sector: "行业轮动",
  sentiment: "投资者情绪",
  technical: "价格与技术结构",
  businessQuality: "生意质量",
  management: "管理层与资本配置",
  fundamentals: "财务质量",
  valuation: "内在价值与估值",
  balanceSheet: "资产负债表",
  earnings: "盈利能力",
  growth: "盈利增长",
  credit: "信用周期",
  crossAsset: "跨资产相关性",
  portfolioRisk: "组合风险贡献",
});

const METHODOLOGY_VERSION = "hengce-manager-distillation@1.0.0";
const DEFAULT_EVIDENCE_POLICY = Object.freeze({
  primarySourceRequired: true,
  minimumIndependentSources: 2,
  conflictTolerance: 0.01,
  missingDataAction: "research-only",
});

const MANAGER_OPERATING_POLICIES = Object.freeze({
  "quant-balanced": { decisionCadence: "daily-and-event-driven", assetClasses: ["public equities", "ETFs"], markets: ["A股", "美股"], initialPosition: "10%–30%计划仓位", maxRiskPerIdea: "0.5%", reviewCadence: "每日行情、每周组合复核" },
  buffett: { decisionCadence: "quarterly-and-event-driven", assetClasses: ["public equities"], markets: ["A股", "美股"], initialPosition: "15%–25%计划仓位", maxRiskPerIdea: "0.4%", reviewCadence: "季度财报与重大事件" },
  munger: { decisionCadence: "quarterly-and-event-driven", assetClasses: ["public equities"], markets: ["A股", "美股"], initialPosition: "15%–20%计划仓位", maxRiskPerIdea: "0.35%", reviewCadence: "季度复核与重大治理事件" },
  graham: { decisionCadence: "monthly-and-quarterly", assetClasses: ["public equities"], markets: ["A股", "美股"], initialPosition: "5%–10%计划仓位", maxRiskPerIdea: "0.3%", reviewCadence: "月度估值、季度财务复核" },
  lynch: { decisionCadence: "weekly-and-quarterly", assetClasses: ["public equities"], markets: ["A股", "美股"], initialPosition: "10%–15%计划仓位", maxRiskPerIdea: "0.4%", reviewCadence: "周度故事检查、季度增长复核" },
  marks: { decisionCadence: "weekly-and-event-driven", assetClasses: ["public equities", "ETFs", "credit proxies"], markets: ["A股", "美股"], initialPosition: "5%–12%计划仓位", maxRiskPerIdea: "0.3%", reviewCadence: "周度周期温度与信用事件" },
  dalio: { decisionCadence: "weekly-and-monthly", assetClasses: ["股票指数", "政府债券", "通胀敏感资产", "黄金与商品代理", "现金"], markets: ["A股与中国跨资产代理", "美股与全球跨资产代理"], initialPosition: "按组合风险贡献分配，不给单股固定比例", maxRiskPerIdea: "需由跨资产风险模型计算", reviewCadence: "周度风险贡献、月度宏观复核" },
  soros: { decisionCadence: "daily-and-event-driven", assetClasses: ["public equities", "ETFs"], markets: ["A股", "美股"], initialPosition: "8%–35%计划仓位", maxRiskPerIdea: "0.5%", reviewCadence: "每日趋势与事件驱动复核" },
});

const MANAGER_COMPANY_RESEARCH = Object.freeze({
  "quant-balanced": [
    ["products", "产品与客户价值是否有一手事实支持"], ["moat", "竞争优势是否能由经营指标和行业证据交叉验证"],
    ["marketPosition", "市场份额的统计口径、地区与期间是否一致"], ["management", "管理层执行与资本配置是否改善单位经济性"],
    ["growthOutlook", "未来增长假设能否被订单、指引或行业需求证伪"], ["valuation", "价格隐含预期与多情景回报是否匹配"],
    ["catalysts", "催化是否有时间表且能改变盈利或估值"], ["risks", "最强反例、尾部风险和失效条件是什么"],
  ],
  buffett: [
    ["products", "客户为什么持续购买，产品是否创造可重复价值"], ["moat", "定价权、转换成本、网络效应或成本优势能否长期扩大"],
    ["marketPosition", "份额提升来自真实竞争优势还是短期补贴与周期"], ["management", "管理层是否诚实，并把留存收益投向高回报用途"],
    ["growthOutlook", "可再投资跑道还能维持多久，增量资本回报是否下降"], ["valuation", "保守现金流情景相对价格是否留下安全边际"],
    ["catalysts", "哪些经营进展会扩大长期内在价值而非只刺激股价"], ["risks", "什么会永久损害护城河、现金创造与资产负债表"],
  ],
  munger: [
    ["risks", "先倒推这门生意如何造成永久资本损失"], ["management", "激励是否让管理层、销售与股东利益一致"],
    ["moat", "规模优势、品牌、网络和习惯是否形成多因素合力"], ["products", "产品是否简单、必要且不依赖持续促销"],
    ["marketPosition", "行业结构是否允许少数理性竞争者长期共存"], ["valuation", "相对下一最佳机会，质量是否足以补偿价格"],
    ["growthOutlook", "增长是否会诱发低回报扩张、并购或杠杆"], ["catalysts", "催化是否只是让人类偏误和从众更强"],
  ],
  graham: [
    ["valuation", "保守资产价值与标准化盈利相对价格折价多少"], ["risks", "盈利归零或预测错误时仍有哪些可实现保护垫"],
    ["management", "资本配置是否侵蚀净资产与少数股东利益"], ["products", "业务是否足够稳定以支持保守盈利基线"],
    ["marketPosition", "份额和行业地位是否可核验而非叙事溢价"], ["growthOutlook", "预测只作上行选择权，不能替代当前价值"],
    ["moat", "竞争优势只能提高质量，不能取消安全边际"], ["catalysts", "价值回归的资产处置、分红或经营修复路径是什么"],
  ],
  lynch: [
    ["products", "能否用简单语言讲清公司卖什么、客户为何增长"], ["growthOutlook", "公司属于慢增长、稳定、快速成长、周期还是困境反转"],
    ["marketPosition", "渗透率与可服务市场是否仍给增长留下空间"], ["valuation", "盈利增速与估值是否匹配，PEG 只是起点而非答案"],
    ["catalysts", "门店、产品、订单或产能里程碑是否按季度兑现"], ["risks", "库存、债务、现金和同店/单位数据是否开始背离故事"],
    ["management", "管理层是否兑现可理解的经营承诺"], ["moat", "增长来自持久优势还是短期风口"],
  ],
  marks: [
    ["risks", "永久损失、杠杆与极端下行情景是否被充分补偿"], ["valuation", "当前价格中的风险溢价处于历史与周期什么位置"],
    ["catalysts", "催化是否已被共识和拥挤仓位提前反映"], ["growthOutlook", "乐观预期是否依赖单一路径与准确宏观预测"],
    ["management", "管理层是否在周期高点扩张、加杠杆或追逐并购"], ["marketPosition", "竞争地位在下行周期中是否会恶化"],
    ["products", "需求是结构性、周期性还是信用扩张制造"], ["moat", "所谓护城河在压力情景下是否仍存在"],
  ],
  dalio: [
    ["risks", "该资产对增长、通胀、实际利率和流动性冲击的风险贡献是多少"], ["growthOutlook", "未来现金流最依赖哪一种经济环境"],
    ["catalysts", "政策、信用与经济意外会如何改变资产相关性"], ["marketPosition", "行业地位能否降低宏观冲击，还是仍属同一风险因子"],
    ["valuation", "预期回报是否补偿其在整个组合中的边际风险"], ["products", "收入来源分别暴露于哪些增长和通胀驱动"],
    ["management", "融资、期限与对冲政策能否降低流动性脆弱性"], ["moat", "竞争优势能否跨不同经济环境维持现金流"],
  ],
  soros: [
    ["catalysts", "什么事件能改变主流偏见并启动反馈回路"], ["growthOutlook", "预期变化是否可能通过融资、需求或行为反过来改变基本面"],
    ["marketPosition", "份额变化是否正在被价格和资金趋势强化"], ["risks", "哪条事实或价格行为证明反馈回路已经反转"],
    ["valuation", "估值不是止损；市场还需要多大预期差才能继续"], ["products", "产品叙事是否正改变真实客户行为"],
    ["management", "管理层行动会强化还是打断市场偏见"], ["moat", "优势是现实约束还是牛市叙事的自我证明"],
  ],
});

const MANAGER_DEFINITIONS = [
  {
    id: DEFAULT_PORTFOLIO_MANAGER_ID,
    name: "衡策多因子",
    nameEn: "Quant Balanced",
    initials: "衡",
    school: "多因子基准",
    mandate: "在宏观、择时、板块、情绪与技术之间保持期限自适应，不模仿任何个人。",
    horizon: "1天–1年",
    focus: ["证据覆盖", "期限适配", "风险收益"],
    factorBias: { macro: 1, timing: 1, sector: 1, sentiment: 1, technical: 1 },
    requiredCapabilities: ["macro", "timing", "sector", "sentiment", "technical"],
    hardGateCapabilities: [],
    exposureBias: 0,
    exposureFloor: 10,
    exposureCeiling: 90,
  },
  {
    id: "buffett",
    name: "沃伦·巴菲特",
    nameEn: "Warren Buffett",
    initials: "WB",
    avatarSrc: new URL("./assets/portfolio-managers/warren-buffett-avatar.png", import.meta.url).href,
    school: "质量价值",
    mandate: "只在能力圈内研究可长期持有的好生意，并要求管理层可信与价格留有安全边际。",
    horizon: "5–10年以上",
    focus: ["护城河", "所有者收益", "安全边际"],
    factorBias: { macro: 0.9, timing: 0.5, sector: 1.25, sentiment: 0.4, technical: 0.55 },
    requiredCapabilities: ["businessQuality", "management", "fundamentals", "valuation"],
    hardGateCapabilities: ["businessQuality", "fundamentals", "valuation"],
    exposureBias: 5,
    exposureFloor: 15,
    exposureCeiling: 85,
    sources: [
      { title: "Berkshire Hathaway 1986 Chairman's Letter", url: "https://www.berkshirehathaway.com/letters/1986.html", authority: "primary", supports: ["所有者收益", "经济商誉"] },
      { title: "Berkshire Hathaway 2012 Shareholder Letter", url: "https://berkshirehathaway.com/letters/2012ltr.pdf", authority: "primary", supports: ["护城河", "资本配置"] },
      { title: "Berkshire Hathaway 2018 Shareholder Letter", url: "https://berkshirehathaway.com/letters/2018ltr.pdf", authority: "primary", supports: ["优质企业", "合理价格", "真实经济盈利"] },
    ],
  },
  {
    id: "munger",
    name: "查理·芒格",
    nameEn: "Charlie Munger",
    initials: "CM",
    avatarSrc: new URL("./assets/portfolio-managers/charlie-munger-avatar.png", import.meta.url).href,
    school: "质量与多元模型",
    mandate: "先逆向排除会永久损失资本的情形，再用激励、规模优势与多元模型判断企业质量。",
    horizon: "长期集中",
    focus: ["逆向思考", "激励机制", "优质企业"],
    factorBias: { macro: 0.8, timing: 0.45, sector: 1.2, sentiment: 0.45, technical: 0.5 },
    requiredCapabilities: ["businessQuality", "management", "fundamentals", "valuation"],
    hardGateCapabilities: ["businessQuality", "management", "valuation"],
    exposureBias: 3,
    exposureFloor: 15,
    exposureCeiling: 82,
    sources: [
      { title: "A Lesson on Elementary, Worldly Wisdom (USC, 1994)", url: "https://fs.blog/great-talks/a-lesson-on-worldly-wisdom/", authority: "primary-transcript", host: "secondary-archive", supports: ["多元思维模型", "集中于少数高把握机会"] },
      { title: "The Psychology of Human Misjudgment (Harvard, 1995)", url: "https://fs.blog/great-talks/psychology-human-misjudgment/", authority: "primary-transcript", host: "secondary-archive", supports: ["激励机制", "认知偏误与逆向检查"] },
    ],
  },
  {
    id: "graham",
    name: "本杰明·格雷厄姆",
    nameEn: "Benjamin Graham",
    initials: "BG",
    avatarSrc: new URL("./assets/portfolio-managers/benjamin-graham-avatar.png", import.meta.url).href,
    school: "深度价值",
    mandate: "从资产负债表与可验证盈利出发，以足够折价购买，并把预测错误留在安全边际内。",
    horizon: "1–3年价值回归",
    focus: ["资产价值", "盈利能力", "安全边际"],
    factorBias: { macro: 0.7, timing: 0.4, sector: 0.8, sentiment: 0.3, technical: 0.35 },
    requiredCapabilities: ["balanceSheet", "earnings", "valuation"],
    hardGateCapabilities: ["balanceSheet", "earnings", "valuation"],
    exposureBias: -5,
    exposureFloor: 10,
    exposureCeiling: 75,
    sources: [
      { title: "Benjamin Graham: A 1976 Financial Analysts Journal Interview", url: "https://rpc.cfainstitute.org/-/media/documents/book/rf-publication/1977/rf-v1977-n1-4731-pdf.pdf", authority: "primary", supports: ["低估值纪律", "独立思考"] },
      { title: "CFA Institute — Margin of Safety: The Lost Art", url: "https://rpc.cfainstitute.org/blogs/enterprising-investor/2015/margin-of-safety-the-lost-art", authority: "institutional", supports: ["安全边际", "审慎估值"] },
      { title: "CFA Institute — Living Legends", url: "https://rpc.cfainstitute.org/research/cfa-magazine/2003/living-legends", authority: "institutional-interview", supports: ["安全边际", "投资与投机边界"] },
    ],
  },
  {
    id: "lynch",
    name: "彼得·林奇",
    nameEn: "Peter Lynch",
    initials: "PL",
    avatarSrc: new URL("./assets/portfolio-managers/peter-lynch-avatar.png", import.meta.url).href,
    school: "合理价格成长",
    mandate: "研究能用简单语言讲清楚的公司，区分成长类型，并持续核对增长故事与财务事实。",
    horizon: "3–5年",
    focus: ["可理解的生意", "盈利增长", "PEG纪律"],
    factorBias: { macro: 0.6, timing: 0.75, sector: 1.4, sentiment: 0.8, technical: 0.8 },
    requiredCapabilities: ["sector", "growth", "fundamentals", "valuation"],
    hardGateCapabilities: ["growth", "fundamentals"],
    exposureBias: 2,
    exposureFloor: 12,
    exposureCeiling: 85,
    sources: [
      { title: "Fidelity Investing Legends Transcript — Peter Lynch", url: "https://www.fidelity.com/bin-public/060_www_fidelity_com/documents/learning-center/Transcript_Investing%20legends_v2.pdf", authority: "primary", supports: ["理解公司故事", "检查财务与PEG"] },
      { title: "Fidelity Trading Guide — Peter Lynch Research Principle", url: "https://www.fidelity.com/viewpoints/active-investor/trading-guide-managing-investment-risks-and-opportunities", authority: "institutional", supports: ["从熟悉领域找线索", "研究后再持有"] },
      { title: "Fidelity — Learn from Investing Legends", url: "https://www.fidelity.com/bin-public/060_www_fidelity_com/documents/learning-center/Presentation_Investing%20legends.pdf", authority: "institutional-transcript", supports: ["公司故事", "PEG", "库存与债务检查"] },
    ],
  },
  {
    id: "marks",
    name: "霍华德·马克斯",
    nameEn: "Howard Marks",
    initials: "HM",
    avatarSrc: new URL("./assets/portfolio-managers/howard-marks-avatar.png", import.meta.url).href,
    school: "周期与风险",
    mandate: "先判断市场位于周期何处、风险是否被充分定价，再决定进攻或防守，而非预测单一路径。",
    horizon: "跨周期",
    focus: ["第二层思维", "市场周期", "风险溢价"],
    factorBias: { macro: 1.45, timing: 1.15, sector: 0.85, sentiment: 1.4, technical: 0.55 },
    requiredCapabilities: ["macro", "timing", "sentiment", "credit"],
    hardGateCapabilities: [],
    exposureBias: -8,
    exposureFloor: 10,
    exposureCeiling: 72,
    sources: [
      { title: "Howard Marks — Taking the Temperature", url: "https://www.oaktreecapital.com/insights/memo/taking-the-temperature", authority: "primary", supports: ["周期温度", "第二层思维"] },
      { title: "Howard Marks — The Best of the Memos", url: "https://www.oaktreecapital.com/insights/memo/the-best-of", authority: "primary", supports: ["风险控制", "周期与逆向思考"] },
      { title: "Howard Marks — The Indispensability of Risk", url: "https://www.oaktreecapital.com/insights/memo/the-indispensability-of-risk", authority: "primary", supports: ["风险与回报", "赔率与不确定性"] },
    ],
  },
  {
    id: "dalio",
    name: "瑞·达利欧",
    nameEn: "Ray Dalio",
    initials: "RD",
    school: "跨资产宏观风险平衡",
    mandate: "把股票、债券、通胀敏感资产、黄金与现金放进增长和通胀四象限，以跨资产相关性和风险贡献实现分散；不用于孤立单股定仓。",
    horizon: "宏观周期",
    focus: ["宏观增长/通胀四象限", "跨资产相关性", "组合风险贡献"],
    factorBias: { macro: 1.8, timing: 1.35, sector: 1, sentiment: 0.65, technical: 0.65 },
    requiredCapabilities: ["macro", "crossAsset", "portfolioRisk"],
    hardGateCapabilities: ["macro", "crossAsset", "portfolioRisk"],
    decisionScope: "portfolio-only",
    methodologyBoundary: "全天候是多资产组合构建框架；单只股票只能提供宏观敏感度和边际风险输入，不能独立产生全天候仓位。",
    exposureBias: -3,
    exposureFloor: 12,
    exposureCeiling: 78,
    sources: [
      { title: "Bridgewater — The All Weather Story", url: "https://www.bridgewater.com/research-and-insights/the-all-weather-story", authority: "primary", supports: ["全天候", "风险平衡与经济惊喜"] },
      { title: "Ray Dalio — Principles for Navigating Big Debt Crises", url: "https://www.bridgewater.com/big-debt-crises/principles-for-navigating-big-debt-crises-by-ray-dalio.pdf", authority: "primary", supports: ["债务周期", "通胀型与通缩型去杠杆"] },
      { title: "Bridgewater — Investing in a New World", url: "https://www.bridgewater.com/research-and-insights/investing-in-a-new-world-capturing-opportunity-and-weathering-uncertainty", authority: "primary", supports: ["增长与通胀风险平衡", "股票与债券的跨资产组合"] },
    ],
  },
  {
    id: "soros",
    name: "乔治·索罗斯",
    nameEn: "George Soros",
    initials: "GS",
    school: "反身性宏观",
    mandate: "观察叙事、价格与资金之间的反馈回路；允许快速纠错，并只在非对称机会中集中风险。",
    horizon: "数周–数月",
    focus: ["反身性", "趋势确认", "快速纠错"],
    factorBias: { macro: 1.25, timing: 1.6, sector: 1.1, sentiment: 1.3, technical: 1.5 },
    requiredCapabilities: ["macro", "timing", "sentiment", "technical"],
    hardGateCapabilities: [],
    exposureBias: 0,
    exposureFloor: 8,
    exposureCeiling: 88,
    sources: [
      { title: "George Soros — Financial Markets Lecture Transcript", url: "https://www.opensocietyfoundations.org/uploads/2b96bb8c-e2e1-4d88-9eea-badf16d0a2b8/george-soros-financial-markets-transcript.pdf", authority: "primary", supports: ["反身性", "正负反馈回路"] },
      { title: "Open Society Foundations — Soros CEU Lecture Series", url: "https://www.opensocietyfoundations.org/publications/george-soros-open-society-financial-crisis-and-way-ahead", authority: "primary-host", supports: ["反身性讲座系列", "市场偏见与现实的双向影响"] },
      { title: "George Soros — General Theory of Reflexivity Transcript", url: "https://www.opensocietyfoundations.org/uploads/9ae17912-2262-4646-8ffc-d01afc934c36/george-soros-general-theory-of-reflexivity-transcript.pdf", authority: "primary", supports: ["易错性", "参与者认知与现实的双向作用"] },
    ],
  },
];

export const PORTFOLIO_MANAGERS = Object.freeze(MANAGER_DEFINITIONS.map((manager) => {
  const policy = MANAGER_OPERATING_POLICIES[manager.id];
  return Object.freeze({
    ...manager,
    methodologyVersion: METHODOLOGY_VERSION,
    decisionCadence: policy.decisionCadence,
    universe: Object.freeze({
      assetClasses: Object.freeze([...policy.assetClasses]),
      markets: Object.freeze([...policy.markets]),
      exclusions: Object.freeze(["无法验证身份或来源的标的", "关键事实缺失且无法补证的结论"]),
      dataRequirements: Object.freeze(manager.hardGateCapabilities?.length ? [...manager.hardGateCapabilities] : ["market-data"]),
    }),
    evidencePolicy: DEFAULT_EVIDENCE_POLICY,
    sizingPolicy: Object.freeze({ initialPosition: policy.initialPosition, maxRiskPerIdea: policy.maxRiskPerIdea }),
    monitoringPolicy: Object.freeze({
      reviewCadence: policy.reviewCadence,
      thesisAssumptionRange: Object.freeze([3, 7]),
      invalidationRule: "红线触发或关键假设破裂时必须重新评估",
    }),
    researchQuestions: Object.freeze((MANAGER_COMPANY_RESEARCH[manager.id] || MANAGER_COMPANY_RESEARCH[DEFAULT_PORTFOLIO_MANAGER_ID]).map(([id, question]) => Object.freeze({ id, question }))),
  });
}));

const MANAGER_BY_ID = new Map(PORTFOLIO_MANAGERS.map((manager) => [manager.id, manager]));

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizedPreferences(value = {}) {
  const targetReturn = Number(value.targetReturn);
  const riskCapacity = Number(value.riskCapacity);
  return {
    targetReturn: clamp(Number.isFinite(targetReturn) ? targetReturn : 12, 0, 100),
    riskCapacity: clamp(Number.isFinite(riskCapacity) ? riskCapacity : 50, 0, 100),
  };
}

export function resolvePortfolioManager(id) {
  return MANAGER_BY_ID.get(id) || MANAGER_BY_ID.get(DEFAULT_PORTFOLIO_MANAGER_ID);
}

export function assignPortfolioManager(portfolio, managerId) {
  return { ...portfolio, managerId: resolvePortfolioManager(managerId).id };
}

export function managerWeightsFor(baseWeights, managerId, preferencesValue = {}) {
  const manager = resolvePortfolioManager(managerId);
  const preferences = normalizedPreferences(preferencesValue);
  const riskDelta = (preferences.riskCapacity - 50) / 50;
  const returnDelta = (preferences.targetReturn - 12) / 88;
  const preferenceBias = {
    macro: 1 - riskDelta * 0.14,
    timing: 1 + riskDelta * 0.16 + returnDelta * 0.06,
    sector: 1 + returnDelta * 0.1,
    sentiment: 1 - riskDelta * 0.08,
    technical: 1 + riskDelta * 0.18 + returnDelta * 0.12,
  };
  const entries = Object.entries(baseWeights).map(([id, value]) => [
    id,
    Math.max(0, Number(value) || 0) * (manager.factorBias[id] ?? 1) * (preferenceBias[id] ?? 1),
  ]);
  const total = entries.reduce((sum, [, value]) => sum + value, 0) || 1;
  const normalized = Object.fromEntries(entries.map(([id, value]) => [id, Math.round(value / total * 1000) / 10]));
  const currentTotal = Object.values(normalized).reduce((sum, value) => sum + value, 0);
  const adjustmentKey = entries.reduce((best, entry) => entry[1] > best[1] ? entry : best, entries[0])[0];
  normalized[adjustmentKey] = Math.round((normalized[adjustmentKey] + 100 - currentTotal) * 10) / 10;
  return normalized;
}

export function managerCoverageFor(managerId, availableCapabilities = []) {
  const manager = resolvePortfolioManager(managerId);
  const available = new Set(availableCapabilities);
  const required = manager.requiredCapabilities;
  const missing = required.filter((capability) => !available.has(capability));
  const missingHardGates = manager.hardGateCapabilities.filter((capability) => !available.has(capability));
  const coverage = required.length ? Math.round((required.length - missing.length) / required.length * 100) : 100;
  return {
    id: manager.id,
    name: manager.name,
    nameEn: manager.nameEn,
    initials: manager.initials,
    school: manager.school,
    mandate: manager.mandate,
    horizon: manager.horizon,
    focus: manager.focus,
    coverage,
    missing,
    missingLabels: missing.map((capability) => CAPABILITY_LABELS[capability] || capability),
    missingHardGates,
    constrained: missingHardGates.length > 0,
  };
}

export function applyManagerDecisionGate(action, managerPerspective) {
  if (action.verb !== "买入" || !managerPerspective.constrained) return action;
  if (managerPerspective.id === "dalio") {
    return {
      code: "dalio-portfolio-risk-input",
      label: "先进入跨资产组合风险模型",
      tone: "caution",
      verb: "等待",
      horizon: action.horizon,
      summary: "单股行情只提供增长、通胀与流动性敏感度输入。缺少跨资产相关性和组合风险贡献时，不把它包装成全天候仓位。",
    };
  }
  const missing = managerPerspective.missingLabels.join("、");
  return {
    code: `${managerPerspective.id}-research-gate`,
    label: `${managerPerspective.name}：补齐${missing}后再建仓`,
    tone: "caution",
    verb: "等待",
    horizon: action.horizon,
    summary: `价格与市场条件已经进入观察区，但${managerPerspective.name}方法论的关键证据仍缺少${missing}。当前只保留研究候选，不把技术信号升级为买入。`,
  };
}

export function applyManagerActionPolicy(action, managerPerspective, signals = {}) {
  const managerId = managerPerspective.id;
  if (action.verb === "买入") {
    if (managerId === "dalio") {
      return {
        ...action,
        code: "dalio-portfolio-risk-input",
        label: "转入跨资产组合风险模型",
        tone: "caution",
        verb: "等待",
        summary: "单只股票的研究结果只能作为增长、通胀和流动性敏感度输入；即使宏观证据齐全，也必须先计算跨资产相关性与组合风险贡献，不能由单股页面直接给出全天候仓位。",
      };
    }
    if (managerId === "marks" && (signals.sentimentCrowded || signals.riskConstrainedEnvironment)) {
      return {
        ...action,
        code: "marks-cycle-defense",
        label: "周期温度偏热，先提高安全边际",
        tone: "caution",
        verb: "等待",
        summary: "价格结构仍有吸引力，但风险偏好拥挤或宏观处于防守区。按周期与第二层思维，先等待市场给出更高风险溢价。",
      };
    }
    if (managerId === "marks") {
      return {
        ...action,
        code: "marks-cycle-entry",
        label: "周期温度允许，以防守仓试探",
        summary: `${action.summary} 按周期方法降低首笔暴露，并为极端结果保留现金。`,
      };
    }
    if (managerId === "soros") {
      if (!signals.trendAligned) {
        return {
          ...action,
          code: "soros-wait-feedback",
          label: "反馈回路尚未确认，等待趋势",
          tone: "caution",
          verb: "等待",
          summary: "基本环境具备条件，但价格、动量与资金尚未形成自我强化的反馈回路；不在反身性证据不足时提前下注。",
        };
      }
      return {
        ...action,
        code: "soros-reflexive-entry",
        label: "趋势反馈增强，带失效位参与",
        summary: `${action.summary} 允许顺势提高首笔暴露，但一旦反馈回路反转就快速纠错。`,
      };
    }
  }

  if (managerId === "marks" && action.verb === "等待") {
    return {
      ...action,
      code: "marks-cycle-observe",
      label: "风险温度未给出足够补偿，继续防守",
      summary: `${action.summary} 按周期与风险溢价框架，当前不用趋势代替安全边际。`,
    };
  }
  if (managerId === "soros" && action.verb === "卖出/减仓" && signals.technicallyWeak) {
    return { ...action, code: "soros-thesis-break", label: "反馈回路反转，快速降低风险" };
  }
  if (managerId === "marks" && action.verb === "卖出/减仓") {
    return { ...action, code: "marks-cycle-reduce", label: "风险补偿下降，转入防守" };
  }
  return action;
}

export function managerAllocationRangeFor(managerId, signals = {}) {
  const manager = resolvePortfolioManager(managerId);
  if (signals.actionVerb !== "买入") return null;
  if (manager.id === "dalio") return null;
  if (manager.id === DEFAULT_PORTFOLIO_MANAGER_ID && signals.baseAllocation) {
    const range = String(signals.baseAllocation).match(/(\d+(?:\.\d+)?)%\s*[–—-]\s*(\d+(?:\.\d+)?)%/);
    if (range) {
      return { lowPct: Number(range[1]), highPct: Number(range[2]), maxRiskPct: 0.5 };
    }
  }
  const constrained = signals.riskConstrainedEnvironment || signals.sentimentCrowded;
  const allocations = {
    "quant-balanced": constrained ? [10, 20, 0.5] : [20, 30, 0.5],
    buffett: [15, 25, 0.4],
    munger: [15, 20, 0.35],
    graham: [5, 10, 0.3],
    lynch: [10, 15, 0.4],
    marks: constrained ? [5, 8, 0.25] : [8, 12, 0.3],
    soros: constrained ? [8, 12, 0.4] : [25, 35, 0.5],
  };
  const [baseLow, baseHigh, maxRiskPct] = allocations[manager.id] || allocations[DEFAULT_PORTFOLIO_MANAGER_ID];
  const preferences = normalizedPreferences(signals.analysisPreferences);
  const capacityFactor = 0.55 + preferences.riskCapacity / 100 * 0.9;
  const lowPct = Math.max(1, Math.round(baseLow * capacityFactor));
  const highPct = Math.max(lowPct + 1, Math.round(baseHigh * capacityFactor));
  return { lowPct, highPct, maxRiskPct };
}

export function managerAllocationFor(managerId, signals = {}) {
  const manager = resolvePortfolioManager(managerId);
  const range = managerAllocationRangeFor(managerId, signals);
  if (!range) return "当前不新增仓位；已有持仓按失效位管理";
  const preferences = normalizedPreferences(signals.analysisPreferences);
  return `${manager.name}首笔${range.lowPct}%–${range.highPct}%计划仓位；风险承担 ${preferences.riskCapacity}/100；单次最大风险不超过组合净值${range.maxRiskPct}%`;
}

export function applyManagerExposurePolicy(target, managerId, preferencesValue = {}) {
  const manager = resolvePortfolioManager(managerId);
  const preferences = normalizedPreferences(preferencesValue);
  const rawValue = Number(target?.value ?? target?.targetExposurePct ?? 50);
  const riskAdjustment = (preferences.riskCapacity - 50) * 0.22;
  const value = Math.round(clamp(rawValue + manager.exposureBias + riskAdjustment, manager.exposureFloor, manager.exposureCeiling) * 10) / 10;
  const bias = manager.exposureBias === 0 ? "不偏移" : `${manager.exposureBias > 0 ? "+" : "−"}${Math.abs(manager.exposureBias)}pct`;
  return {
    ...target,
    value,
    targetExposurePct: value,
    label: `${manager.name} · ${target?.label || target?.detailLabel || "组合目标"} · 经理偏移${bias} · 目标年化${preferences.targetReturn}% · 风险${preferences.riskCapacity}/100`,
  };
}
