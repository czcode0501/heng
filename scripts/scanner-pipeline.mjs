export function candidatesFromPrescreen(manifest, perMarketLimit = 40) {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest?.markets)) {
    throw new Error("初筛清单格式不正确");
  }
  if (!Number.isInteger(perMarketLimit) || perMarketLimit < 1) {
    throw new Error("深度分析数量必须为正整数");
  }
  return manifest.markets.flatMap((market) => {
    const officialUniverse = Number(market?.counts?.officialUniverse) || Number(market?.counts?.universe) || 0;
    return (Array.isArray(market?.candidates) ? market.candidates : [])
      .slice(0, perMarketLimit)
      .map((candidate) => ({
        ...candidate,
        symbol: candidate.symbol || candidate.providerSymbol,
        providerSymbol: candidate.providerSymbol,
        market: market.market,
        sector: candidate.sectorId || null,
        prescreenScore: candidate.score ?? null,
        officialUniverse,
      }))
      .filter(({ providerSymbol }) => Boolean(providerSymbol));
  });
}

export function summarizeDecisionRows(rows) {
  const successful = rows.filter(({ error }) => !error);
  const distribution = successful.reduce((counts, row) => {
    counts[row.action] = (counts[row.action] || 0) + 1;
    return counts;
  }, {});
  return {
    candidates: rows.length,
    successful: successful.length,
    failed: rows.length - successful.length,
    distribution,
  };
}
