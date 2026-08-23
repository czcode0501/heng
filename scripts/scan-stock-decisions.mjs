import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { buildStockDecision } from "../signals/stock-analysis/decision.js";
import { candidatesFromPrescreen, summarizeDecisionRows } from "./scanner-pipeline.mjs";
import { resolvePythonExecutable } from "./python-runtime.mjs";

const baseUrl = process.env.QUANT_DESK_URL || "http://127.0.0.1:5173";
const argv = process.argv.slice(2);

function option(name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

function flag(name) {
  return argv.includes(name);
}

const market = option("--market", "both");
const deepLimit = Number.parseInt(option("--deep-limit", "40"), 10);
const maxSymbols = Number.parseInt(option("--max-symbols", "0"), 10);
const concurrency = Number.parseInt(option("--concurrency", "4"), 10);
const prescreenFile = resolve(option("--prescreen-file", "output/scanner/prescreen-latest.json"));
const decisionFile = resolve(option("--output", "output/scanner/decisions-latest.json"));

function runPrescreen() {
  const args = [
    "scripts/prescreen-market.py",
    "--market", market,
    "--top-n", String(deepLimit),
    "--output", prescreenFile,
  ];
  if (maxSymbols > 0) args.push("--max-symbols", String(maxSymbols));
  if (flag("--fresh")) args.push("--fresh");
  if (flag("--refresh-universe")) args.push("--refresh-universe");
  const executable = resolvePythonExecutable();
  if (!executable) throw new Error("No working Python interpreter was found. Re-run setup or set QUANT_DESK_PYTHON.");
  const result = spawnSync(executable, args, { cwd: process.cwd(), stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`第一层扫描失败（退出码 ${result.status ?? "unknown"}）`);
}

if (!flag("--skip-prescreen")) runPrescreen();
if (!existsSync(prescreenFile)) throw new Error(`找不到初筛清单：${prescreenFile}`);

const manifest = JSON.parse(readFileSync(prescreenFile, "utf8"));
const candidates = candidatesFromPrescreen(manifest, deepLimit);
if (!candidates.length) throw new Error("第一层扫描没有产生可供深度分析的候选股票");

async function json(path) {
  const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(45_000) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || `HTTP ${response.status}`);
  return payload.data;
}

function decisionContext(workspaces, candidate) {
  const macroMarket = workspaces.macro.markets.find(({ id }) => id === candidate.market);
  const timingMarket = workspaces.marketTiming.markets.find(({ id }) => id === candidate.market);
  const sectorMarket = workspaces.sectorRotation.markets.find(({ id }) => id === candidate.market);
  const sentimentMarket = workspaces.investorSentiment.markets.find(({ id }) => id === candidate.market);
  const sector = sectorMarket?.sectors.find(({ id }) => id === candidate.sector);
  return {
    held: false,
    macro: macroMarket?.analysis || null,
    timing: timingMarket?.regime || null,
    sector: sector ? {
      id: sector.id,
      title: sector.title,
      score: sector.score,
      rank: sector.rotation?.rank,
      phase: sector.rotation?.phase?.label || (sector.score >= 65 ? "领先" : sector.score <= 40 ? "落后" : "中性轮动"),
      flowScore: sector.capitalFlow?.score,
      flowState: sector.capitalFlow?.state?.label,
      flowTone: sector.capitalFlow?.state?.tone,
    } : null,
    sentiment: sentimentMarket?.score != null ? {
      score: sentimentMarket.score,
      impulse: sentimentMarket.impulse20d,
      phase: sentimentMarket.phase?.label,
      tone: sentimentMarket.phase?.tone,
      confidence: sentimentMarket.confidence,
    } : null,
  };
}

async function enrichCandidate(candidate) {
  if (candidate.sector || candidate.market === "china") return candidate;
  try {
    const results = await json(`/api/instruments/search?q=${encodeURIComponent(candidate.providerSymbol)}`);
    const exact = results.find(({ providerSymbol }) => providerSymbol === candidate.providerSymbol);
    return { ...candidate, sector: exact?.sectorId || null, name: exact?.name || candidate.name };
  } catch {
    return candidate;
  }
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, limit) }, run));
  return results;
}

const bootstrap = await json("/api/signals");
const rows = await mapWithConcurrency(candidates, concurrency, async (rawCandidate) => {
  const candidate = await enrichCandidate(rawCandidate);
  try {
    const payload = await json(`/api/analysis?symbol=${encodeURIComponent(candidate.providerSymbol)}&range=3m`);
    const context = decisionContext(bootstrap.workspaces, candidate);
    const decision = buildStockDecision(payload, { ...context, holdingPeriod: "3m" });
    return {
      market: candidate.market === "china" ? "CN" : "US",
      symbol: candidate.symbol,
      providerSymbol: candidate.providerSymbol,
      name: candidate.name || candidate.symbol,
      officialUniverse: candidate.officialUniverse,
      prescreenScore: candidate.prescreenScore,
      sector: decision.evidence.find(({ id }) => id === "sector")?.label || candidate.sector || "待识别",
      price: payload.price,
      score: decision.composite.score,
      action: decision.action.verb,
      code: decision.action.code,
      location: decision.location.label,
      entry: decision.tradePlan.entry?.midpoint ?? null,
      target: decision.tradePlan.target?.midpoint ?? null,
      invalidation: decision.invalidation,
      expectedReturn: decision.tradePlan.expectedReturnPercent,
      riskReward: decision.tradePlan.riskReward,
      allocation: decision.allocation,
      label: decision.action.label,
    };
  } catch (error) {
    return {
      market: candidate.market === "china" ? "CN" : "US",
      symbol: candidate.symbol,
      providerSymbol: candidate.providerSymbol,
      prescreenScore: candidate.prescreenScore,
      error: error.message,
    };
  }
});

const summary = summarizeDecisionRows(rows);
const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  scanDate: manifest.scanDate,
  mode: manifest.mode,
  baseUrl,
  prescreen: manifest.markets.map(({ market: marketId, counts, elapsedSeconds }) => ({ market: marketId, counts, elapsedSeconds })),
  ...summary,
  rows,
};
mkdirSync(dirname(decisionFile), { recursive: true });
writeFileSync(decisionFile, JSON.stringify(output, null, 2), "utf8");

console.log(JSON.stringify({ generatedAt: output.generatedAt, mode: output.mode, ...summary }, null, 2));
console.table(rows.map((row) => ({
  市场: row.market,
  股票: row.symbol,
  初筛: row.prescreenScore,
  五层: row.score,
  板块: row.sector,
  现价: row.price,
  动作: row.action || "失败",
  位置: row.location || row.error,
  买入参考: row.entry,
  目标参考: row.target,
  失效位: row.invalidation,
  预期回报: row.expectedReturn == null ? null : `${row.expectedReturn.toFixed(1)}%`,
  风险收益: row.riskReward == null ? null : row.riskReward.toFixed(2),
  结论: row.label,
})));
console.log(`results=${decisionFile}`);
