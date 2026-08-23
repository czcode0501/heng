import { assessEvidenceQuality, buildManagerDecisionWorkflow, managerContractFor } from "../../portfolio-manager-contract.js";
import { PORTFOLIO_MANAGERS, mostDifferentPortfolioManager, resolvePortfolioManager } from "../../portfolio-managers.js";
import { buildCompanyResearchDossier } from "./company-research-dossier.js";

function finite(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function rate(current, previous) {
  const a = finite(current);
  const b = finite(previous);
  return a != null && b ? (a / b - 1) * 100 : null;
}

function comparablePriorYear(periods, latest) {
  const latestDate = new Date(`${latest?.periodEnd || ""}T00:00:00Z`);
  if (Number.isNaN(latestDate.getTime())) return {};
  return periods.slice(1).find((period) => {
    const candidate = new Date(`${period?.periodEnd || ""}T00:00:00Z`);
    return !Number.isNaN(candidate.getTime())
      && candidate.getUTCFullYear() === latestDate.getUTCFullYear() - 1
      && Math.abs(candidate.getUTCMonth() - latestDate.getUTCMonth()) <= 1;
  }) || {};
}

function researchCapabilities(research, dossier) {
  const latest = research?.fundamentals?.periods?.[0] || {};
  const previous = comparablePriorYear(research?.fundamentals?.periods || [], latest);
  const capabilities = [];
  if ([latest.revenue, latest.netIncome, latest.freeCashFlow].every((value) => value != null)) capabilities.push("fundamentals", "earnings");
  if ([latest.assets, latest.liabilities].every((value) => value != null)) capabilities.push("balanceSheet");
  if ([latest.revenue, latest.netIncome, previous.revenue, previous.netIncome].every((value) => value != null)) capabilities.push("growth");
  const section = (id) => dossier?.sections?.find((item) => item.id === id);
  if (["products", "moat"].every((id) => section(id)?.status !== "missing")) capabilities.push("businessQuality");
  if (section("management")?.status !== "missing") capabilities.push("management");
  if (section("valuation")?.status !== "missing") capabilities.push("valuation");
  return [...new Set(capabilities)];
}

function evidenceFromResearch(research) {
  const latest = research?.fundamentals?.periods?.[0];
  if (!latest) return assessEvidenceQuality();
  const source = research?.fundamentals?.source;
  const authority = source?.quality === "primary" ? "primary" : "independent";
  const criticalFacts = ["revenue", "netIncome", "freeCashFlow", "assets", "liabilities"]
    .filter((id) => latest[id] != null)
    .map((id) => {
      const supplied = research?.financialEvidence?.[id]?.sources || research?.fundamentals?.verification?.[id]?.sources || [];
      return {
        id,
        sources: supplied.length ? supplied : [{ provider: source?.label || "unknown", authority, value: latest[id] }],
      };
    });
  return assessEvidenceQuality({ criticalFacts, requiredFactIds: ["revenue", "netIncome", "freeCashFlow", "assets", "liabilities"] });
}

function managerScore(research, managerId) {
  const periods = research?.fundamentals?.periods || [];
  const latest = periods[0] || {};
  const previous = comparablePriorYear(periods, latest);
  const revenueGrowth = rate(latest.revenue, previous.revenue);
  const earningsGrowth = rate(latest.netIncome, previous.netIncome);
  const fcfMargin = finite(latest.freeCashFlow) != null && finite(latest.revenue) ? latest.freeCashFlow / latest.revenue * 100 : null;
  const liabilityRatio = finite(latest.liabilities) != null && finite(latest.assets) ? latest.liabilities / latest.assets * 100 : null;
  const positiveNews = (research?.news || []).some(({ title, summary }) => /raise|growth|beat|improv|上调|增长|超预期|改善/i.test(`${title} ${summary}`));
  const evidenceValues = [revenueGrowth, earningsGrowth, fcfMargin, liabilityRatio].filter((value) => value != null);
  if (!evidenceValues.length) return null;
  const scores = {
    "quant-balanced": [revenueGrowth, earningsGrowth, fcfMargin].filter((value) => value != null).reduce((sum, value) => sum + clamp(50 + value), 0),
    buffett: 50 + (fcfMargin == null ? 0 : clamp(fcfMargin, -20, 25)) + (liabilityRatio == null ? 0 : clamp((60 - liabilityRatio) / 2, -10, 15)),
    munger: 48 + (fcfMargin == null ? 0 : clamp(fcfMargin, -20, 25)) + (liabilityRatio == null ? 0 : clamp((55 - liabilityRatio) / 2, -12, 15)),
    graham: 45 + (liabilityRatio == null ? 0 : clamp((65 - liabilityRatio) / 1.5, -15, 20)),
    lynch: 48 + (revenueGrowth == null ? 0 : clamp(revenueGrowth / 1.5, -20, 25)) + (earningsGrowth == null ? 0 : clamp(earningsGrowth / 2, -15, 20)),
    marks: 50 + (liabilityRatio == null ? 0 : clamp((50 - liabilityRatio) / 2, -20, 15)),
    dalio: 50 + (revenueGrowth == null ? 0 : clamp(revenueGrowth / 3, -12, 12)) + (liabilityRatio == null ? 0 : clamp((55 - liabilityRatio) / 3, -12, 12)),
    soros: 50 + (revenueGrowth == null ? 0 : clamp(revenueGrowth / 1.3, -20, 28)) + (positiveNews ? 8 : 0),
  };
  const raw = scores[managerId];
  if (managerId === "quant-balanced") {
    const count = [revenueGrowth, earningsGrowth, fcfMargin].filter((value) => value != null).length;
    return count ? clamp(raw / count) : 50;
  }
  return clamp(raw ?? 50);
}

const MANAGER_RESEARCH_LENSES = Object.freeze({
  "quant-balanced": { focus: ["增长质量", "现金流", "多层证据一致性"], methodology: "用财务增长、现金流与市场证据做覆盖度加权，不让缺失项得到中性分。" },
  buffett: { focus: ["生意质量", "护城河", "所有者现金流"], methodology: "先核验生意质量、护城河和现金流的可持续性，再谈价格与长期持有。" },
  munger: { focus: ["永久损失", "激励机制", "现金流质量"], methodology: "先用逆向清单寻找永久损失路径，再检查激励、杠杆与现金流质量。" },
  graham: { focus: ["资产负债表", "可验证盈利", "安全边际"], methodology: "从资产负债表与可验证盈利出发；没有估值与折价证据就停在研究阶段。" },
  lynch: { focus: ["收入增长", "盈利兑现", "故事与数字"], methodology: "比较增长故事与收入、利润和现金流事实，持续寻找背离。" },
  marks: { focus: ["下行风险", "周期温度", "风险补偿"], methodology: "先问下行风险是否被充分定价，再判断当前周期是否值得承担风险。" },
  dalio: { focus: ["宏观敏感度", "资产负债表", "风险贡献"], methodology: "把公司财务韧性放入增长、通胀和流动性情景中检查风险贡献。" },
  soros: { focus: ["预期变化", "新闻催化", "趋势反馈"], methodology: "观察基本事实、新闻预期与价格趋势是否形成反身性反馈，并预先定义反转条件。" },
});

const MANAGER_CHALLENGES = Object.freeze({
  "quant-balanced": "如果财务、市场与价格三层证据不再同向，哪一层应先降低仓位？",
  buffett: "自由现金流来自可重复经营，还是营运资本与一次性项目暂时抬高？",
  munger: "管理层激励、杠杆或行业结构中，哪一项可能造成永久性资本损失？",
  graham: "即使盈利预测全部落空，资产与可验证现金流是否仍提供足够安全边际？",
  lynch: "公司的增长故事是否已经由收入、利润和现金流同时兑现，而不是只兑现一个数字？",
  marks: "如果风险溢价继续收窄，当前价格是否仍然补偿永久损失与周期下行风险？",
  dalio: "在增长放缓、通胀再起或流动性收紧情景中，这家公司会增加多少组合风险贡献？",
  soros: "如果新闻催化消退且价格不再确认，反馈回路是否已经反转？",
});

function percent(value, { signed = false } = {}) {
  if (value == null) return "待补证";
  const prefix = signed && value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}%`;
}

function researchFacts(research) {
  const periods = research?.fundamentals?.periods || [];
  const latest = periods[0] || {};
  const previous = comparablePriorYear(periods, latest);
  const latestEvent = (research?.news || [])[0] || null;
  return Object.freeze({
    periodEnd: latest.periodEnd || null,
    comparisonPeriodEnd: previous.periodEnd || null,
    revenueGrowth: rate(latest.revenue, previous.revenue),
    earningsGrowth: rate(latest.netIncome, previous.netIncome),
    freeCashFlowMargin: finite(latest.freeCashFlow) != null && finite(latest.revenue)
      ? latest.freeCashFlow / latest.revenue * 100
      : null,
    liabilityRatio: finite(latest.liabilities) != null && finite(latest.assets)
      ? latest.liabilities / latest.assets * 100
      : null,
    latestEventTitle: latestEvent?.title || null,
    latestEventType: latestEvent?.sourceType || null,
    eventCount: (research?.news || []).length,
  });
}

function dossierReadFor(managerId, dossier) {
  const status = (id) => dossier.sections.find((section) => section.id === id)?.status === "missing" ? "待补证" : "已有资料";
  const reads = {
    "quant-balanced": `完整性检查：产品 ${status("products")}、护城河 ${status("moat")}、市场地位 ${status("marketPosition")}、管理层 ${status("management")}、未来预期 ${status("growthOutlook")}、估值 ${status("valuation")}。我会按证据覆盖率降低确信度，不用已有数字替代缺失维度。`,
    buffett: `数字只告诉我过去发生了什么。产品与客户价值 ${status("products")}，护城河 ${status("moat")}，管理层资本配置 ${status("management")}，市场地位 ${status("marketPosition")}。这四项和可再投资跑道、合理价格没有同时成立前，我不会把增长叫作长期复利。`,
    munger: `我先检查永久损失路径：管理层与激励 ${status("management")}、护城河 ${status("moat")}、行业地位 ${status("marketPosition")}、公司特定风险 ${status("risks")}。任何一个关键缺口都可能让漂亮报表成为错误模型的产物。`,
    graham: `我把预测放在最后：估值保护垫 ${status("valuation")}、失败情景 ${status("risks")}、资产与管理层证据 ${status("management")}。产品和增长可以增加上行，但不能替代当前价格相对保守价值的折价。`,
    lynch: `我要把故事拆成可跟踪里程碑：产品 ${status("products")}、市场空间与份额 ${status("marketPosition")}、未来预期 ${status("growthOutlook")}、估值 ${status("valuation")}、催化 ${status("catalysts")}。每个季度都要检查故事和库存、债务、利润、现金是否一起兑现。`,
    marks: `我先寻找没被价格补偿的风险：失败情景 ${status("risks")}、估值与风险溢价 ${status("valuation")}、周期催化 ${status("catalysts")}、管理层在高低周期的资本配置 ${status("management")}。经营好转并不自动等于赔率好。`,
    dalio: `这不是单股选美。公司产品 ${status("products")}、未来现金流 ${status("growthOutlook")} 和融资风险 ${status("risks")} 只负责刻画宏观敏感度；还必须补齐股票、债券、黄金等跨资产相关性与组合风险贡献，才谈配置。`,
    soros: `我在寻找认知与现实的双向变化：催化 ${status("catalysts")}、未来预期 ${status("growthOutlook")}、市场地位 ${status("marketPosition")}、反转风险 ${status("risks")}。这些事实还要被价格和资金连续确认，否则只是未形成反馈的故事。`,
  };
  return reads[managerId] || reads["quant-balanced"];
}

function narrativeFor(managerId, facts, { verdict, missingHardGates, evidence, dossier }) {
  const revenue = percent(facts.revenueGrowth, { signed: true });
  const earnings = percent(facts.earningsGrowth, { signed: true });
  const cash = percent(facts.freeCashFlowMargin);
  const leverage = percent(facts.liabilityRatio);
  const event = facts.latestEventTitle ? `最近事件是“${facts.latestEventTitle}”` : "目前没有可核验的近期公司事件";
  const gate = evidence.status === "insufficient"
    ? "关键公司事实尚未接入，当前只能建立待研究清单，不能形成方向性结论。"
    : evidence.status === "conflict"
      ? "关键事实存在来源冲突，冲突消除前停止决策。"
      : missingHardGates.length
    ? `目前仍缺少${missingHardGates.join("、")}，所以结论只能停在研究层。`
    : evidence.status !== "verified"
      ? "核心研究维度已有资料，但关键事实尚未完成双源核验，只能进入人工研究复核。"
      : "核心研究门槛与双源核验已覆盖，可以进入人工决策复核。";
  const boundary = evidence.grade === "A"
    ? "关键事实已有独立来源相互核验，但仍需在下单前复查价格与披露时点。"
    : evidence.status === "conflict"
      ? "关键事实存在来源冲突，在冲突消除前不形成交易动作。"
      : "关键财务事实目前主要来自一个权威来源；这足以形成研究判断，但不足以单独升级为买入决定。";

  const narratives = {
    "quant-balanced": {
      opening: `我先看证据是否同向：营收同比 ${revenue}、净利润同比 ${earnings}、自由现金流率 ${cash}。三项不能互相替代，缺失数据也不会按中性处理。`,
      factRead: `资产负债表显示负债占资产 ${leverage}；${event}。当前证据组合对应“${verdict}”，真正重要的是增长、现金流与事件是否持续同向。`,
      action: `${gate} 在下一次复核中，我会优先检查现金流与盈利增长是否继续一致，再决定是否提高研究优先级。`,
      changeMind: "只要财务、事件和价格三层证据出现持续背离，我就会下调结论，而不是用某个漂亮指标抵消其他风险。",
    },
    buffett: {
      opening: `我把这只股票先当作一门生意。营收同比 ${revenue}、净利润同比 ${earnings}，但我更在意每一元收入能留下多少可自由支配的现金——当前自由现金流率是 ${cash}。`,
      factRead: `负债占资产 ${leverage}，这是检验长期复利能否穿越坏年份的第一道约束；${event}。单季增长不能证明护城河，只有多年稳定现金创造才有意义。`,
      action: `${gate} 我会继续等待可持续竞争优势、资本回报与合理价格的证据，不会仅因一条利好或一个季度增长追价。`,
      changeMind: "如果自由现金流主要来自一次性营运资本释放，或杠杆上升却没有带来更强经营现金回报，我会推翻这份正面判断。",
    },
    munger: {
      opening: `我先倒过来想：什么会让这笔投资永久亏损？当前负债占资产 ${leverage}，自由现金流率 ${cash}，这两项比营收同比 ${revenue} 更先进入我的失败清单。`,
      factRead: `净利润同比 ${earnings}；${event}。我不会把增长自动等同于质量，还要追问激励机制、行业结构和会计利润能否真正变成现金。`,
      action: `${gate} 在弄清杠杆、管理层资本配置和现金流可重复性之前，我宁愿错过，也不愿靠乐观假设完成论证。`,
      changeMind: "若出现激励失真、激进并购、现金利润背离或行业结构恶化中的任一项，我会把它从候选清单移除。",
    },
    graham: {
      opening: `我先寻找能核验的保护垫。负债占资产 ${leverage}，净利润同比 ${earnings}，但没有资产价值和估值折价，就不能把盈利增长叫作安全边际。`,
      factRead: `营收同比 ${revenue}、自由现金流率 ${cash}；${event}。这些数据说明经营现状，却没有回答最关键的问题：当前价格相对保守价值究竟便宜多少。`,
      action: `${gate} 在估值、流动资产保护和盈利正常化数据补齐前，我只做观察，不把好公司与好价格混为一谈。`,
      changeMind: "如果保守盈利下修后仍无折价，或者资产负债表恶化侵蚀保护垫，我会直接否定买入条件。",
    },
    lynch: {
      opening: `故事必须落在数字上。当前营收同比 ${revenue}、净利润同比 ${earnings}、自由现金流率 ${cash}；如果三者不同步，漂亮故事就要打折。`,
      factRead: `${event}。我会把这条事件和下一期收入、利润及现金流逐一对照，判断它是真正的经营拐点，还是市场已经听过很多次的宣传。`,
      action: `${gate} 我会先把公司归入合适的成长类型，再检查增长持续时间与估值，绝不会仅凭“热门行业”给出买入。`,
      changeMind: "若收入增长放缓、利润依靠非经常项目，或现金流长期跟不上盈利，公司的故事就不再成立。",
    },
    marks: {
      opening: `我先问风险是否得到补偿，而不是先问还能涨多少。负债占资产 ${leverage}、自由现金流率 ${cash}，决定它在周期下行时有多少承受力。`,
      factRead: `营收同比 ${revenue}、净利润同比 ${earnings}；${event}。经营改善是事实，但没有估值与周期位置，就还不能判断市场价格是否留出了犯错空间。`,
      action: `${gate} 我会保持防守性观察，等风险溢价、周期位置与下行情景能够被量化后，再决定是否承担这份风险。`,
      changeMind: "如果风险溢价继续收窄、杠杆上升或现金流在下行阶段转弱，我会降低风险预算，即使增长数字仍然好看。",
    },
    dalio: {
      opening: `我把公司放进不同经济机器里看。营收同比 ${revenue}、净利润同比 ${earnings}，但负债占资产 ${leverage} 决定它对利率和流动性变化的敏感度。`,
      factRead: `自由现金流率 ${cash}；${event}。这些公司事实还要与增长、通胀、实际利率和流动性情景结合，才能判断它给组合增加的是收益来源还是同向风险。`,
      action: `${gate} 我不会孤立地给单只股票定仓，而会先测算它在现有组合中的风险贡献以及与其他资产的相关性。`,
      changeMind: "若增长放缓与融资条件收紧同时发生，而公司现金流无法覆盖负债压力，我会把风险贡献迅速降下来。",
    },
    soros: {
      opening: `我看事实如何改变预期，再看价格是否反过来强化基本面。营收同比 ${revenue}、净利润同比 ${earnings}；${event}，这可能成为预期差的触发点。`,
      factRead: `自由现金流率 ${cash}、负债占资产 ${leverage}。数据给出基本面底座，但反身性是否成立，要看指引、新闻催化与价格趋势能否连续互相确认。`,
      action: `${gate} 即使进入交易观察，我也只会在催化与价格确认同时出现时行动，并预先设定反馈回路失效后的退出条件。`,
      changeMind: "如果利好发布后价格不再确认、预期差快速消失或趋势反转，我会承认判断失效，而不会用长期故事拖延退出。",
    },
  };
  return { ...narratives[managerId], businessRead: dossierReadFor(managerId, dossier), evidenceBoundary: boundary };
}

export function buildCompanyManagerInsight(research, managerId) {
  const contract = managerContractFor(managerId);
  const lens = MANAGER_RESEARCH_LENSES[contract.id];
  const dossier = buildCompanyResearchDossier(research, contract.id);
  const evidence = evidenceFromResearch(research);
  const capabilities = researchCapabilities(research, dossier);
  const workflow = buildManagerDecisionWorkflow(contract.id, capabilities, evidence);
  const rawScore = managerScore(research, contract.id);
  const score = rawScore == null ? null : Math.round(rawScore * 10) / 10;
  const decisionScope = contract.id === "dalio" ? "portfolio-risk-input" : "single-security-research";
  if (decisionScope === "portfolio-risk-input") {
    workflow.canBuy = false;
    workflow.scopeBlocked = true;
    const decideStep = workflow.steps.find(({ id }) => id === "decide");
    if (decideStep) decideStep.status = "blocked";
  }
  const verdict = evidence.status === "conflict"
    ? "数据冲突，停止决策"
    : evidence.status === "insufficient" || score == null
      ? "关键事实不足，仅保留观察"
      : decisionScope === "portfolio-risk-input"
        ? "仅作组合风险输入，不做单股定仓"
    : workflow.missingHardGates.length
      ? "待补关键证据"
      : workflow.evidenceBlocked
        ? `${contract.name}研究候选，买入闸门未通过`
        : score >= 65 ? "进入经理复核" : score <= 40 ? "暂不进入候选" : "条件性观察";
  const facts = researchFacts(research);
  return {
    manager: contract,
    score,
    verdict,
    decisionScope,
    focus: lens.focus,
    methodology: lens.methodology,
    evidence,
    capabilities,
    workflow,
    dossier,
    challenge: MANAGER_CHALLENGES[contract.id],
    facts,
    narrative: narrativeFor(contract.id, facts, {
      verdict,
      missingHardGates: workflow.missingHardGateLabels || workflow.missingHardGates,
      evidence,
      dossier,
    }),
  };
}

function comparisonItem(insight, selected = false) {
  const manager = resolvePortfolioManager(insight.manager.id);
  const unable = insight.evidence.status !== "verified" || !insight.workflow.canBuy;
  return {
    managerId: manager.id,
    methodName: manager.methodName,
    sourceLabel: manager.sourceLabel,
    selected,
    focus: insight.focus[0] || "待补证",
    conclusion: unable ? "此方法无法形成结论" : insight.verdict,
    conclusionDetail: unable ? insight.verdict : insight.narrative.action,
    maxPosition: unable ? "0%（仅研究）" : manager.sizingPolicy.initialPosition,
    action: unable ? "等待补证" : insight.verdict,
    waitingCondition: unable ? `补齐${(insight.workflow.missingHardGateLabels || []).join("、") || "关键事实的 A 级双源核验"}` : insight.narrative.action,
    exitDiscipline: manager.monitoringPolicy.invalidationRule,
    worry: manager.worry,
    changeCondition: insight.narrative.changeMind || manager.changeCondition,
    evidenceGrade: insight.evidence.grade,
    reviewCadence: manager.monitoringPolicy.reviewCadence,
  };
}

export function buildCompanyMethodComparison(research, managerId) {
  const current = resolvePortfolioManager(managerId);
  const counter = mostDifferentPortfolioManager(current.id);
  const insights = new Map(PORTFOLIO_MANAGERS.map((manager) => [manager.id, buildCompanyManagerInsight(research, manager.id)]));
  return {
    current: comparisonItem(insights.get(current.id), true),
    counter: comparisonItem(insights.get(counter.id)),
    all: PORTFOLIO_MANAGERS.map((manager) => comparisonItem(insights.get(manager.id), manager.id === current.id)),
  };
}

export function companyResearchRefreshDelay(research) {
  const seconds = Number(research?.meta?.refreshAfterSeconds);
  return Math.max(30_000, Number.isFinite(seconds) ? seconds * 1000 : 600_000);
}
