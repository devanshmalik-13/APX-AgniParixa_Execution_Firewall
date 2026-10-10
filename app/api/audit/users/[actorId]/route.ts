import { NextResponse } from "next/server";
import { listActorLogs } from "@/lib/security/run-store";

export async function GET(request: Request, context: { params: Promise<{ actorId: string }> }) {
  try {
    const { actorId } = await context.params;
    const page = Number(new URL(request.url).searchParams.get("page") ?? 0);
    if (!Number.isInteger(page) || page < 0 || page > 10000) return NextResponse.json({ error: "Page must be an integer between 0 and 10000." }, { status: 400 });
    const analyzed = new URL(request.url).searchParams.get("view") === "analyzed";
    return NextResponse.json(await listActorLogs(actorId, page, analyzed));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Audit lookup failed" }, { status: 500 }); }
}
