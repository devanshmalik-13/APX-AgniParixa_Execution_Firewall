import { NextResponse } from "next/server";
import { listActorLogs } from "@/lib/security/run-store";

export async function GET(request: Request, context: { params: Promise<{ actorId: string }> }) {
  try {
    const { actorId } = await context.params;
    const page = Math.max(0, Math.min(10000, Number(new URL(request.url).searchParams.get("page") ?? 0) || 0));
    const analyzed = new URL(request.url).searchParams.get("view") === "analyzed";
    return NextResponse.json(await listActorLogs(actorId, page, analyzed));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Audit lookup failed" }, { status: 500 }); }
}
