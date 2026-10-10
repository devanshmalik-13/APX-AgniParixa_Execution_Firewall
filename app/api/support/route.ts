import { supportContext, supportError, supportResponse } from "./_shared";

export async function GET(request: Request) {
  try {
    const { owner, store } = supportContext(request);
    return supportResponse(await store.dashboard(owner));
  } catch (error) { return supportError(error); }
}
