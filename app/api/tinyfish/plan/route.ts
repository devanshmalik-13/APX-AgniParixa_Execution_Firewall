import { z } from "zod";
import { supportContext, readSupportBody, supportResponse, supportError } from "../../support/_shared";

const inputSchema = z.object({ticketId:z.string().min(1).max(100),evidenceId:z.string().uuid()}).strict();
export async function POST(request:Request){
  try{
    const {owner,store}=supportContext(request,true);
    const input=inputSchema.parse(await readSupportBody(request,1000));
    return supportResponse({plan:await store.stageReference(owner,input.ticketId,input.evidenceId)},201);
  }catch(error){return supportError(error);}
}
