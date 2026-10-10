import { observerRequestSchema } from "@/lib/observer/server";
import { readSupportBody, supportContext, supportError, supportResponse } from "../support/_shared";

/** Authenticated readiness reveals no endpoint, bearer token, or provider diagnostic. */
export async function GET(request: Request) {
  try {
    const { observer } = supportContext(request);
    return supportResponse({ config: await observer.getConfig() });
  } catch (error) { return supportError(error); }
}

/** Advisory inference only; no plan, grant, approval, or connector side effect. */
export async function POST(request: Request) {
  try {
    const { observer } = supportContext(request, true);
    const input = observerRequestSchema.parse(await readSupportBody(request, 64_000));
    return supportResponse({ observation: await observer.observe(input) });
  } catch (error) { return supportError(error); }
}
