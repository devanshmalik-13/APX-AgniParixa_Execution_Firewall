import { SupportStoreError } from "@/lib/support/store";
import { operationSchema, readSupportBody, supportContext, supportError, supportResponse, validatePlanId } from "../../_shared";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const { owner, store } = supportContext(request);
    const { id } = await context.params;
    validatePlanId(id);
    const plan = await store.get(owner, id);
    if (!plan) throw new SupportStoreError(404, "Support plan was not found.");
    return supportResponse({ plan });
  } catch (error) { return supportError(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const { owner, store } = supportContext(request, true);
    const { id } = await context.params;
    validatePlanId(id);
    const input = operationSchema.parse(await readSupportBody(request));
    return supportResponse({ plan: await store.operate(owner, id, input) });
  } catch (error) { return supportError(error); }
}
