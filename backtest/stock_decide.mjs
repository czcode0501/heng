// 用应用自己的 buildStockDecision 对回放输入逐条决策：node backtest/stock_decide.mjs <input.jsonl> <output.jsonl>
import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { buildStockDecision } from "../signals/stock-analysis/decision.js";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error("usage: node backtest/stock_decide.mjs <input.jsonl> <output.jsonl>");
  process.exit(2);
}

const output = createWriteStream(outputPath);
let count = 0;
for await (const line of createInterface({ input: createReadStream(inputPath) })) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  const decision = buildStockDecision(row.payload, { ...row.context, holdingDays: row.holdingDays });
  output.write(`${JSON.stringify({
    id: row.id,
    verb: decision.action.verb,
    code: decision.action.code,
    reason: decision.action.reason || null,
    composite: decision.composite.score,
    entry: decision.tradePlan.entry,
    target: decision.tradePlan.target,
    invalidation: decision.invalidation,
    riskReward: decision.tradePlan.riskReward,
  })}\n`);
  count += 1;
}
output.end();
await new Promise((resolve) => output.on("finish", resolve));
console.error(`decisions ${count}`);
