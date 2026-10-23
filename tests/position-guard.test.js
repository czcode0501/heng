import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { positionRecordGuard } from "../position-guard.js";

const waitDecision = {
  action: { verb: "等待", label: "投资者情绪谨慎降温，等待企稳" },
  tradePlan: { entry: { low: 338.18, high: 339.41, midpoint: 338.8 } },
};
const buyDecision = {
  action: { verb: "买入", label: "支撑区小仓验证" },
  tradePlan: { entry: { low: 206, high: 210, midpoint: 208 } },
};

test("a wait decision turns adding into acknowledged record-keeping", () => {
  const guard = positionRecordGuard(waitDecision, { cost: 338.5 });

  assert.equal(guard.mode, "record-only");
  assert.equal(guard.requiresAcknowledgement, true);
  assert.equal(guard.buttonLabel, "记录已成交持仓");
  assert.equal(guard.submitLabel, "记录这笔成交");
  assert.match(guard.warnings[0], /当前结论为“等待”.*不建议现在新建仓位/);
});

test("adding without any analysis is also record-only", () => {
  const guard = positionRecordGuard(null, { cost: 100 });
  assert.equal(guard.requiresAcknowledgement, true);
  assert.match(guard.warnings[0], /尚未完成个股分析/);
});

test("a buy decision keeps the normal flow but flags a cost above the entry zone", () => {
  const inside = positionRecordGuard(buyDecision, { cost: 209 });
  assert.equal(inside.mode, "buy-plan");
  assert.equal(inside.requiresAcknowledgement, false);
  assert.deepEqual(inside.warnings, []);

  // 实测：默认价格 347.73 高于软件自己的买入区上沿 339.41。
  const above = positionRecordGuard({ ...buyDecision, tradePlan: waitDecision.tradePlan }, { cost: 347.73 });
  assert.match(above.warnings.join(" "), /高于参考买入区上沿 2\.5%/);
});

test("price warnings are suppressed when evidence is insufficient and no levels are shown", () => {
  const guard = positionRecordGuard(waitDecision, { cost: 347.73, sufficient: false });
  assert.equal(guard.warnings.length, 1);
  assert.doesNotMatch(guard.warnings[0], /买入区上沿/);
});

test("the add-position dialog exposes the guard and the acknowledgement checkbox", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.match(html, /id="add-position-guard"[^>]*role="alert"/);
  assert.match(html, /id="position-ack"/);
  assert.match(html, /我已在券商成交，这里只做记录/);
  assert.match(app, /guard\?\.requiresAcknowledgement && !elements\.positionAck\.checked/);
});
