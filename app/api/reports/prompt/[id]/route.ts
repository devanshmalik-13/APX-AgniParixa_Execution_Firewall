import { NextResponse } from "next/server";
import { getPromptDetail } from "@/lib/security/run-store";
import { createIncidentReport } from "@/lib/security/pdf-report";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid prompt id" }, { status: 400 });
    const record = await getPromptDetail(id);
    if (!record) return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    const bytes = await createIncidentReport([record], "prompt");
    return new Response(new Uint8Array(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="apx-incident-${id}.pdf"`, "cache-control": "private, no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Report generation failed" }, { status: 500 }); }
}
