import { NextResponse } from "next/server";
import { getPromptDetail } from "@/lib/security/run-store";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const detail = await getPromptDetail(id);
    return detail ? NextResponse.json(detail) : NextResponse.json({ error: "Prompt not found" }, { status: 404 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Audit lookup failed" }, { status: 500 }); }
}
