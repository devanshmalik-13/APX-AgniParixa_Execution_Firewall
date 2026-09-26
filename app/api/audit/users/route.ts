import { NextResponse } from "next/server";
import { listActorSummaries } from "@/lib/security/run-store";

export async function GET() {
  try { return NextResponse.json({ users: await listActorSummaries() }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Audit lookup failed" }, { status: 500 }); }
}
