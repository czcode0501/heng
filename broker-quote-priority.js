function normalizedSymbol(value) {
  return String(value || "").trim().toUpperCase().replace(/\.(US|NASDAQ|NYSE)$/, "");
}

export function preferBrokerQuote(stock, fallbackQuote, ibkrSnapshot) {
  if (String(stock?.currency || "").toUpperCase() !== "USD") return fallbackQuote;
  const symbol = normalizedSymbol(stock?.symbol || stock?.providerSymbol);
  const position = (ibkrSnapshot?.positions || []).find((candidate) => (
    String(candidate?.currency || "").toUpperCase() === "USD"
      && normalizedSymbol(candidate?.symbol) === symbol
      && Number.isFinite(Number(candidate?.marketPrice))
      && Number(candidate.marketPrice) > 0
  ));
  if (!position) return fallbackQuote;
  return {
    ...fallbackQuote,
    price: Number(position.marketPrice),
    timestamp: ibkrSnapshot?.fetchedAt || ibkrSnapshot?.timestamp || ibkrSnapshot?.meta?.timestamp || fallbackQuote?.timestamp || null,
    source: ibkrSnapshot?.meta?.priceSource || "IBKR TWS Account Window",
    marketDataType: "account-valuation",
    sourcePriority: "ibkr-position",
  };
}
