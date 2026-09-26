import { NextResponse } from "next/server";
import { getRunMetrics, listPromptRecords, listRuns, setAnalystVerdict } from "@/lib/security/run-store";
import { z } from "zod";

export async function GET() {
  try {
    const [prompts, runs, metrics] = await Promise.all([listPromptRecords(200), listRuns(200), getRunMetrics()]);
    return NextResponse.json({ prompts, runs, metrics, storage: "D1", note: "Rates use all server-recorded fixture runs in enforce mode; the visible log shows the latest 200." });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Audit lookup failed" }, { status: 500 });
  }
}

const verdictSchema = z.object({ runId: z.string().uuid(), verdict: z.enum(["contained", "safe"]) });

export async function PATCH(request: Request) {
  try {
    const { runId, verdict } = verdictSchema.parse(await request.json());
    const result = await setAnalystVerdict(runId, verdict);
    return NextResponse.json(result, { status: result.updated ? 200 : 409 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid verdict" }, { status: 400 });
  }
}
