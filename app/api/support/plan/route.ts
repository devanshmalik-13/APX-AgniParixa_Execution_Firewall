import { planRequestSchema, readSupportBody, supportContext, supportError, supportResponse } from "../_shared";

export async function POST(request: Request) {
  try {
    const { owner, store } = supportContext(request, true);
    const input = planRequestSchema.parse(await readSupportBody(request));
    return supportResponse({ plan: await store.stage(owner, input) }, 201);
  } catch (error) { return supportError(error); }
}
