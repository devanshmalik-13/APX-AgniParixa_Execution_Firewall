import { externalProposalSchema } from "@/lib/execution/request";
import { readSupportBody, connectedSupportContext, supportError, supportResponse } from "../../support/_shared";

export async function POST(request: Request) {
  try {
    const { owner, store } = await connectedSupportContext(request, true);
    const input = externalProposalSchema.parse(await readSupportBody(request));
    return supportResponse({ plan: await store.stageExternal(owner, input) }, 201);
  } catch (error) { return supportError(error); }
}
