import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { runGateway } from "@/lib/security/gateway";
import { gatewayRequestSchema } from "@/lib/security/request-schema";
import { attackScenarios, demoTask } from "@/lib/security/scenarios";
import { markPromptRejected, recordPrompt } from "@/lib/security/run-store";
import { actorForScenario, attackLevels, demoActors, proposeAction } from "@/lib/security/attack-lab";

export async function POST(request: Request) {
  let promptId: string | undefined;
  try {
    const raw = await request.json() as Record<string, unknown>;
    const prompt = typeof raw?.prompt === "string" ? raw.prompt : "";
    if (!prompt || prompt.length > 10_000) return NextResponse.json({ error: "Prompt must be 1–10,000 characters." }, { status: 400 });
    const fixture = attackScenarios.find((item) => item.id === raw?.scenarioId && item.prompt === prompt && (JSON.stringify(item.action) === JSON.stringify(raw?.action) || JSON.stringify(proposeAction(item.id, "easy", prompt)) === JSON.stringify(raw?.action)));
    const requestedActor = demoActors.find((actor) => actor.id === raw?.actorId);
    const actor = requestedActor ?? (typeof raw?.scenarioId === "string" ? actorForScenario(raw.scenarioId) : demoActors[4]);
    const level = attackLevels.find((item) => item === raw?.attackLevel);
    const entry = await recordPrompt({ prompt, source: fixture ? "replay" : "custom", scenarioId: typeof raw?.scenarioId === "string" ? raw.scenarioId : undefined, groundTruth: fixture ? "attack" : "unknown", actorId: actor.id, actorName: actor.name, attackLevel: level });
    promptId = entry.id;
    const body = gatewayRequestSchema.parse(raw);
    return NextResponse.json(await runGateway(demoTask, body.action, body.mode, entry.id));
  } catch (error) {
    if (error instanceof ZodError) {
      if (promptId) await markPromptRejected(promptId, "Invalid action envelope");
      return NextResponse.json({ error: "Invalid action envelope", issues: error.issues }, { status: 400 });
    }
    if (promptId) await markPromptRejected(promptId, error instanceof Error ? error.message : "Gateway failure");
    return NextResponse.json({ error: error instanceof Error ? error.message : "Gateway failure" }, { status: 500 });
  }
}
