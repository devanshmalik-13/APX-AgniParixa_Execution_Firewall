/** A real provider check; key comes through hidden stdin and stays in memory. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { webEvidenceSchema } from "../lib/tinyfish/types";
import { contentHash } from "../lib/tinyfish/client";
import { verifyPlan } from "../lib/support/policy";
import type { SupportDashboard, SupportPlan } from "../lib/support/types";

const base = new URL(process.env.SUPPORT_BASE_URL || "http://localhost:5173");
assert.ok(["localhost","127.0.0.1","[::1]"].includes(base.hostname));
if (!process.stdin.isTTY) throw new Error("Use an interactive terminal for hidden key input. Never pass a key in arguments.");
process.stdin.setRawMode(true);
process.stdin.resume();
console.log("Ready for TinyFish live-check key on hidden stdin. Paste the key and press Enter.");
const key = await new Promise<string>((resolve,reject) => {
  let input="";
  const handler=(chunk:Buffer)=>{
    const text=chunk.toString("utf8");
    if(text.includes("\u0003")){process.stdin.off("data",handler);reject(new Error("Cancelled"));return;}
    input+=text;
    if(/[\r\n]/.test(input)){process.stdin.off("data",handler);resolve(input.split(/[\r\n]/)[0].trim());}
  };
  process.stdin.on("data",handler);
});
process.stdin.setRawMode(false);process.stdin.pause();
if(!/^[\x21-\x7e]{10,512}$/.test(key))throw new Error("Invalid TinyFish key input.");
const headers={origin:base.origin,cookie:"__sites_local_auth=1","content-type":"application/json"};
const report:Record<string,unknown>={checkedAt:new Date().toISOString(),provider:"tinyfish",api:"fetch",liveTinyFish:false,livePlanner:false,published:false};
async function request(path:string,body?:unknown){
  const response=await fetch(new URL(path,base),{headers,method:body?"POST":"GET",...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(90000)});
  const text=await response.text();
  if(text.includes(key))throw new Error("Credential redaction failed.");
  let json:Record<string,unknown>;
  try{json=JSON.parse(text);}catch{throw new Error("The local server returned an unreadable response.");}
  if(!response.ok)throw new Error(typeof json.error==="string"?json.error:"The live check failed.");
  return json;
}
let staged:SupportPlan|undefined;
try{
  await request("/api/support");
  const result=await request("/api/tinyfish",{ticketId:"tkt-1044",sourceId:"stripe-refunds",apiKey:key});
  const evidence=webEvidenceSchema.parse(result.evidence);
  assert.equal(evidence.sha256,await contentHash(evidence.text));
  Object.assign(report,{liveTinyFish:true,evidenceId:evidence.id,source:evidence.url,contentCharacters:evidence.text.length,contentSha256:evidence.sha256,truncated:evidence.truncated});
  console.log("Live TinyFish Fetch succeeded; evidence persisted and content hash verified.");
  const dashboard=await request("/api/support") as unknown as SupportDashboard;
  if(!dashboard.config.liveAvailable)report.plannerReason="Connect a model in the app before the live planning check.";
  else{
    const result=await request("/api/support/plan",{ticketId:"tkt-1044",mode:"live",scenario:"normal",profile:"strict",webEvidenceId:evidence.id});
    staged=result.plan as unknown as SupportPlan;
    assert.equal(staged.webEvidence?.id,evidence.id);assert.ok(await verifyPlan(staged));
    assert.ok(staged.actions.every(action=>action.decision==="block"||action.decision==="approval_required"));
    Object.assign(report,{livePlanner:true,model:staged.model,modelProvider:staged.provider,receiptSealsWebEvidence:true,actionDecisions:staged.actions.map(action=>action.decision)});
    console.log("Live model consumed TinyFish context; exact receipt and mandatory review verified.");
  }
}catch(error){report.error=error instanceof Error?error.message:"Live check failed.";process.exitCode=1;}
finally{
  if(staged){try{await request(`/api/support/plans/${staged.id}`,{operation:"reject",receiptHash:staged.receiptHash,approve:false});report.testPlanRejected=true;console.log("Own live test plan rejected; no execution requested.");}catch{report.testPlanRejected=false;process.exitCode=1;}}
  await writeFile("output/tinyfish-live-check.json",JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}
