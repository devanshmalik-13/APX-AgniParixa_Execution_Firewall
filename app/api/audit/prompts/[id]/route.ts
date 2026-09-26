import { NextResponse } from "next/server";
import { getPromptDetail, markPromptAnalyzed } from "@/lib/security/run-store";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const detail = await getPromptDetail(id);
    return detail ? NextResponse.json(detail) : NextResponse.json({ error: "Prompt not found" }, { status: 404 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Audit lookup failed" }, { status: 500 }); }
}

export async function PATCH(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid prompt id" }, { status: 400 });
    const analyzedAt = await markPromptAnalyzed(id);
    return analyzedAt ? NextResponse.json({ analyzedAt }) : NextResponse.json({ error: "Prompt not found or already analyzed" }, { status: 409 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Audit update failed" }, { status: 500 }); }
}
