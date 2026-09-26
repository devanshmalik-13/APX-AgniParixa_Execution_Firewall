import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ status: "ok", service: "agentshield-gateway", policyVersion: "2026.09", connectors: ["filesystem", "database", "email", "memory"] });
}
