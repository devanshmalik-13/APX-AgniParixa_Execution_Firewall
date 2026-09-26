import { exportAllAuditRecords } from "@/lib/security/run-store";

export async function GET() {
  try {
    const data = await exportAllAuditRecords();
    return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), ...data }, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": "attachment; filename=apx-audit.json",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Export failed" }, { status: 500 });
  }
}
