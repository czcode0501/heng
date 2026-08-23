import test from "node:test";
import assert from "node:assert/strict";

import {
  assessEvidenceQuality,
  buildManagerDecisionWorkflow,
  calculateThesisHealth,
  managerContractFor,
  managerFactorContributions,
  buildManagerDecisionGeometry,
  relativeSourceDifference,
} from "../portfolio-manager-contract.js";
import { PORTFOLIO_MANAGERS } from "../portfolio-managers.js";

test("every manager resolves through one complete distilled contract", () => {
  for (const manager of PORTFOLIO_MANAGERS) {
    const contract = managerContractFor(manager.id);
    assert.equal(contract.id, manager.id);
    assert.match(contract.methodologyVersion, /^hengce-manager-distillation@/);
    assert.ok(contract.decisionCadence);
    assert.ok(contract.universe.assetClasses.length);
    assert.deepEqual(contract.decisionProcess.map(({ id }) => id), ["screen", "research", "challenge", "decide", "monitor"]);
    assert.equal(contract.evidencePolicy.conflictTolerance, 0.01);
    assert.equal(contract.evidencePolicy.missingDataAction, "research-only");
    assert.ok(contract.monitoringPolicy.reviewCadence);
    assert.equal(contract.researchQuestions.length, 8);
    assert.deepEqual(new Set(contract.researchQuestions.map(({ id }) => id)), new Set(["products", "moat", "marketPosition", "management", "growthOutlook", "valuation", "catalysts", "risks"]));
  }
});

test("factor contribution explains normalized manager differences without changing the facts", () => {
  const base = { macro: 15, timing: 20, sector: 25, sentiment: 10, technical: 30 };
  const buffett = managerFactorContributions(base, "buffett");
  const soros = managerFactorContributions(base, "soros");

  assert.equal(buffett.reduce((sum, item) => sum + item.weight, 0), 100);
  assert.equal(soros.reduce((sum, item) => sum + item.weight, 0), 100);
  assert.ok(buffett.find(({ id }) => id === "technical").weight < soros.find(({ id }) => id === "technical").weight);
  assert.ok(soros.every(({ baseWeight, bias, weight }) => Number.isFinite(baseWeight) && Number.isFinite(bias) && Number.isFinite(weight)));
});

test("financial evidence requires primary and two independent sources for grade A", () => {
  const gradeA = assessEvidenceQuality({ criticalFacts: [{
    id: "revenue",
    sources: [
      { provider: "sec", authority: "primary", value: 100 },
      { provider: "secondary", authority: "independent", value: 100.5 },
    ],
  }] });
  const gradeB = assessEvidenceQuality({ criticalFacts: [{
    id: "revenue",
    sources: [{ provider: "sec", authority: "primary", value: 100 }],
  }] });
  const gradeC = assessEvidenceQuality({ criticalFacts: [] });

  assert.equal(gradeA.grade, "A");
  assert.equal(gradeA.status, "verified");
  assert.equal(gradeB.grade, "B");
  assert.equal(gradeB.status, "unverified");
  assert.equal(gradeC.grade, "C");
  assert.equal(gradeC.status, "insufficient");
});

test("a source difference above one percent creates a conflict gate", () => {
  assert.equal(relativeSourceDifference(100, 101), 0.009900990099009901);
  const evidence = assessEvidenceQuality({ criticalFacts: [{
    id: "freeCashFlow",
    sources: [
      { provider: "filing", authority: "primary", value: 100 },
      { provider: "aggregator", authority: "independent", value: 102 },
    ],
  }] });
  const workflow = buildManagerDecisionWorkflow("buffett", ["businessQuality", "fundamentals", "valuation"], evidence);

  assert.equal(evidence.status, "conflict");
  assert.equal(evidence.conflicts[0].id, "freeCashFlow");
  assert.equal(workflow.canBuy, false);
  assert.equal(workflow.steps.find(({ id }) => id === "decide").status, "blocked");
});

test("single-source grade B evidence cannot pass the buy gate", () => {
  const evidence = assessEvidenceQuality({ criticalFacts: [{
    id: "revenue",
    sources: [{ provider: "filing", authority: "primary", value: 100 }],
  }] });
  const workflow = buildManagerDecisionWorkflow(
    "buffett",
    ["businessQuality", "management", "fundamentals", "valuation"],
    evidence,
  );

  assert.equal(evidence.status, "unverified");
  assert.equal(workflow.canBuy, false);
  assert.equal(workflow.evidenceBlocked, true);
  assert.equal(workflow.steps.find(({ id }) => id === "decide").status, "blocked");
});

test("missing hard-gate capabilities stop research from becoming a buy decision", () => {
  const evidence = assessEvidenceQuality({ criticalFacts: [] });
  const workflow = buildManagerDecisionWorkflow("graham", ["technical", "timing"], evidence);

  assert.equal(workflow.canBuy, false);
  assert.ok(workflow.missingHardGates.includes("valuation"));
  assert.equal(workflow.steps.find(({ id }) => id === "research").status, "waiting");
});

test("thesis health is calculated only when a structured baseline exists", () => {
  assert.equal(calculateThesisHealth({ assumptions: [], redLines: [] }).score, null);
  const result = calculateThesisHealth({
    assumptions: [{ status: "valid" }, { status: "weakened" }, { status: "damaged" }, { status: "broken" }],
    redLines: [{ triggered: false }],
  });
  const redLine = calculateThesisHealth({ assumptions: [{ status: "valid" }], redLines: [{ triggered: true }] });

  assert.equal(result.score, 4);
  assert.equal(result.label, "论文受损");
  assert.equal(redLine.score, 5);
  assert.equal(redLine.redLineTriggered, true);
});

test("manager geometry crosses five fact layers with five decision stages", () => {
  const geometry = buildManagerDecisionGeometry("buffett", {
    availableCapabilities: ["macro", "businessQuality", "fundamentals", "valuation"],
    evidence: assessEvidenceQuality({ criticalFacts: [{
      id: "revenue",
      sources: [
        { provider: "filing", authority: "primary", value: 100 },
        { provider: "independent", authority: "independent", value: 100.4 },
      ],
    }] }),
  });
  assert.deepEqual(geometry.dataAxis.map(({ id }) => id), ["macro", "market", "sector", "company", "portfolio"]);
  assert.deepEqual(geometry.decisionAxis.map(({ id }) => id), ["screen", "research", "challenge", "decide", "monitor"]);
  assert.equal(geometry.cells.length, 25);
  assert.equal(geometry.framework.investorSkills, "persona-blueprint");
  assert.equal(geometry.framework.augur, "factor-attribution");
  assert.equal(geometry.framework.aiBerkshire, "evidence-gate");
  assert.ok(geometry.cells.some(({ dataLayer, decisionStage, emphasis }) => dataLayer === "company" && decisionStage === "research" && emphasis === "primary"));
});

test("the geometry highlights materially different manager research emphasis", () => {
  const buffett = buildManagerDecisionGeometry("buffett");
  const soros = buildManagerDecisionGeometry("soros");
  const signature = (geometry) => geometry.cells.filter(({ emphasis }) => emphasis === "primary").map(({ dataLayer, decisionStage }) => `${dataLayer}:${decisionStage}`);
  assert.notDeepEqual(signature(buffett), signature(soros));
});
