import { NextResponse } from "next/server";
import { getActorReportRecords } from "@/lib/security/run-store";
import { createIncidentReport } from "@/lib/security/pdf-report";

export async function GET(_request: Request, context: { params: Promise<{ actorId: string }> }) {
  try {
    const { actorId } = await context.params;
    if (!/^[a-z0-9-]{1,80}$/i.test(actorId)) return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
    const records = await getActorReportRecords(actorId);
    if (!records.length) return NextResponse.json({ error: "No records for this user" }, { status: 404 });
    const bytes = await createIncidentReport(records, "user");
    return new Response(new Uint8Array(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="apx-user-${actorId}.pdf"`, "cache-control": "private, no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Report generation failed" }, { status: 500 }); }
}
