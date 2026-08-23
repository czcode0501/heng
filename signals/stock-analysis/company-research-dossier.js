const SECTION_DEFINITIONS = Object.freeze([
  { id: "products", label: "产品与客户价值", missingReason: "缺少产品结构、客户价值与收入来源的一手说明。" },
  { id: "moat", label: "护城河证据", missingReason: "护城河不能由利润率自动推断；需要定价权、转换成本、网络效应、成本优势或监管壁垒的可核验证据。" },
  { id: "marketPosition", label: "市场地位/份额", missingReason: "缺少带统计口径、地区、期间和来源的市场份额或竞争排名。" },
  { id: "management", label: "管理层与资本配置", missingReason: "缺少管理层履历、激励、回购/分红/并购和资本配置记录。" },
  { id: "growthOutlook", label: "未来预期", missingReason: "缺少公司指引、订单/产能、行业需求或可证伪的未来增长假设。" },
  { id: "valuation", label: "估值与回报前提", missingReason: "缺少当前市值、标准化盈利、估值区间和情景回报；历史增长不等于合理价格。" },
  { id: "catalysts", label: "催化与里程碑", missingReason: "当前没有可核验的产品、财报、监管或资本配置催化。" },
  { id: "risks", label: "失败情景与风险", missingReason: "缺少公司特定风险、反方证据和可证伪条件。" },
]);

const MANAGER_PRIORITY_ORDER = Object.freeze({
  "quant-balanced": ["products", "growthOutlook", "valuation", "catalysts", "risks", "moat", "marketPosition", "management"],
  buffett: ["products", "moat", "management", "marketPosition", "growthOutlook", "valuation", "risks", "catalysts"],
  munger: ["risks", "management", "moat", "products", "marketPosition", "valuation", "growthOutlook", "catalysts"],
  graham: ["valuation", "risks", "management", "products", "marketPosition", "growthOutlook", "moat", "catalysts"],
  lynch: ["products", "growthOutlook", "marketPosition", "valuation", "catalysts", "risks", "management", "moat"],
  marks: ["risks", "valuation", "catalysts", "growthOutlook", "management", "marketPosition", "products", "moat"],
  dalio: ["risks", "growthOutlook", "catalysts", "marketPosition", "valuation", "products", "management", "moat"],
  soros: ["catalysts", "growthOutlook", "marketPosition", "risks", "valuation", "products", "management", "moat"],
});

function array(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function sourceFor(item, fallback = null) {
  return item?.source || fallback || null;
}

function normalizeItems(items, fallbackSource = null) {
  return array(items).map((item) => {
    if (typeof item === "string") return { text: item, source: fallbackSource };
    const text = item?.statement || item?.name || item?.title || item?.summary || item?.description || "";
    return text ? { ...item, text, source: sourceFor(item, fallbackSource) } : null;
  }).filter(Boolean);
}

function profileItems(profile, keys) {
  return keys.flatMap((key) => normalizeItems(profile?.[key]));
}

function eventItems(research, matcher) {
  return array(research?.news)
    .filter((event) => matcher.test(`${event?.title || ""} ${event?.summary || ""}`))
    .slice(0, 4)
    .map((event) => ({
      text: event.title,
      detail: event.summary || "",
      asOf: event.publishedAt || null,
      source: { label: event.publisher || "公司事件", url: event.url || null, authority: event.sourceType?.startsWith("official-") ? "primary" : "independent" },
    }));
}

function sectionItems(research, sectionId) {
  const profile = research?.companyProfile || {};
  if (sectionId === "products") {
    const explicit = profileItems(profile, ["products", "mainBusiness", "businessScope", "customerValue"]);
    return explicit.length ? explicit : normalizeItems(profile.description ? [profile.description] : []);
  }
  if (sectionId === "moat") return profileItems(profile, ["moatEvidence", "competitiveAdvantages"]);
  if (sectionId === "marketPosition") return profileItems(profile, ["marketPosition", "marketShare", "competitivePosition"]);
  if (sectionId === "management") return profileItems(profile, ["management", "officers", "capitalAllocation"]);
  if (sectionId === "growthOutlook") {
    return [
      ...profileItems(profile, ["growthOutlook", "guidance", "futureExpectations"]),
      ...eventItems(research, /guidance|outlook|forecast|order|capacity|指引|展望|预期|订单|产能/i),
    ];
  }
  if (sectionId === "valuation") return normalizeItems(research?.valuation?.facts || research?.valuation?.scenarios);
  if (sectionId === "catalysts") {
    return [
      ...profileItems(profile, ["catalysts", "milestones"]),
      ...eventItems(research, /launch|approval|contract|buyback|dividend|acquisition|发布|获批|合同|回购|分红|并购/i),
    ];
  }
  if (sectionId === "risks") {
    return [
      ...profileItems(profile, ["risks", "failureScenarios", "redFlags"]),
      ...eventItems(research, /risk|decline|miss|investigation|recall|lawsuit|warning|风险|下滑|不及|调查|召回|诉讼|警示/i),
    ];
  }
  return [];
}

export function buildCompanyResearchDossier(research, managerId = "quant-balanced") {
  const sections = SECTION_DEFINITIONS.map((definition) => {
    const items = sectionItems(research, definition.id);
    const sourceCount = new Set(items.map(({ source }) => source?.label || source?.url).filter(Boolean)).size;
    return {
      ...definition,
      status: items.length ? (sourceCount >= 2 ? "supported" : "partial") : "missing",
      items,
      sourceCount,
    };
  });
  const sectionMap = new Map(sections.map((section) => [section.id, section]));
  const managerPriorities = (MANAGER_PRIORITY_ORDER[managerId] || MANAGER_PRIORITY_ORDER["quant-balanced"])
    .map((id, index) => ({ ...sectionMap.get(id), priority: index + 1 }));
  const completed = sections.filter(({ status }) => status !== "missing").length;
  return {
    sections,
    managerPriorities,
    coverage: { completed, total: sections.length, percent: Math.round(completed / sections.length * 100) },
  };
}

export function dossierStatusLabel(status) {
  return status === "supported" ? "多源覆盖" : status === "partial" ? "单源/部分覆盖" : "待补证";
}
