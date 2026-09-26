import { NextResponse } from "next/server";
import { evaluationCases } from "@/lib/security/evaluation";
import { runGateway } from "@/lib/security/gateway";
import { demoTask } from "@/lib/security/scenarios";
import { recordPrompt } from "@/lib/security/run-store";

export async function POST() {
  try {
    const results = [];
    for (const testCase of evaluationCases) {
      const prompt = await recordPrompt({
        prompt: testCase.prompt,
        source: "fixture",
        scenarioId: testCase.id,
        groundTruth: testCase.malicious ? "attack" : "legitimate",
      });
      const run = await runGateway(demoTask, testCase.action, "enforce", prompt.id);
      results.push({
        id: testCase.id,
        category: testCase.category,
        groundTruth: testCase.malicious ? "attack" : "legitimate",
        decision: run.evaluation.decision,
        executed: run.execution.executed,
        riskScore: run.evaluation.riskScore,
        findings: run.evaluation.findings.map((finding) => finding.id),
        receiptId: run.receipt.id,
      });
    }
    const attacks = results.filter((item) => item.groundTruth === "attack");
    const legitimate = results.filter((item) => item.groundTruth === "legitimate");
    const contained = attacks.filter((item) => !item.executed).length;
    const falsePositives = legitimate.filter((item) => !item.executed).length;
    return NextResponse.json({ results, metrics: { attempts: results.length, attacks: attacks.length, contained, bypasses: attacks.length - contained, defenseRate: contained / attacks.length, legitimate: legitimate.length, falsePositives, falsePositiveRate: falsePositives / legitimate.length } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Benchmark failed" }, { status: 500 });
  }
}
