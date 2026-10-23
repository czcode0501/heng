// 记录持仓前的风险闸门：衡策不下单，“加入组合”只是记账。
// 结论不是“买入”时，按钮和对话框必须改为“记录已成交持仓”，并要求用户确认已在券商成交，
// 避免新手把“加入组合”理解为平台允许或建议买入。

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function positionRecordGuard(decision, { cost, sufficient = true } = {}) {
  const verb = decision?.action?.verb || null;
  const buyPlan = verb === "买入";
  const warnings = [];

  if (!decision) {
    warnings.push("尚未完成个股分析：衡策没有给出买入结论。仅在你已在券商成交时记录。");
  } else if (!buyPlan) {
    warnings.push(`当前结论为“${verb || "等待"}”（${decision.action.label}）：衡策不建议现在新建仓位。仅在你已在券商成交时记录。`);
  }

  const entryHigh = finite(decision?.tradePlan?.entry?.high);
  const price = finite(cost);
  if (sufficient && entryHigh && price && price > entryHigh * 1.001) {
    const premium = (price / entryHigh - 1) * 100;
    warnings.push(`买入价高于参考买入区上沿 ${premium.toFixed(1)}%，风险收益比会低于计划。`);
  }

  return {
    mode: buyPlan ? "buy-plan" : "record-only",
    requiresAcknowledgement: !buyPlan,
    buttonLabel: buyPlan ? "添加到组合" : "记录已成交持仓",
    title: buyPlan ? "设置建仓数量" : "记录已在券商成交的持仓",
    submitLabel: buyPlan ? "确认加入组合" : "记录这笔成交",
    warnings,
  };
}
