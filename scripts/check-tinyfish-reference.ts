/** Reuse a real successful TinyFish retrieval; validate sandbox reply + recovery. */
import assert from "node:assert/strict";
import { readFile,writeFile } from "node:fs/promises";
import { verifyPlan } from "../lib/support/policy";
import type { SupportPlan,SupportDashboard } from "../lib/support/types";
const base="http://localhost:5173";
const headers={origin:base,cookie:"__sites_local_auth=1","content-type":"application/json"};
async function request(path:string,body?:unknown,expected=200){
  const response=await fetch(base+path,{headers,method:body?"POST":"GET",...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(40000)});
  assert.equal(response.status,expected,`Unexpected status for ${path}`);return await response.json();
}
const live=JSON.parse(await readFile("output/tinyfish-live-check.json","utf8")) as {liveTinyFish:boolean;evidenceId:string;contentSha256:string};
assert.equal(live.liveTinyFish,true,"Run the live TinyFish fetch first");
let plan:SupportPlan|undefined,executed=false,recovered=false;
try{
  const response=await request("/api/tinyfish/plan",{ticketId:"tkt-1044",evidenceId:live.evidenceId},201) as {plan:SupportPlan};
  plan=response.plan;assert.ok(await verifyPlan(plan));assert.equal(plan.webEvidence?.sha256,live.contentSha256);
  assert.equal(plan.model,"tinyfish-reference-draft-v1");assert.equal(plan.actions[0].decision,"approval_required");
  await request(`/api/support/plans/${plan.id}`,{operation:"execute",receiptHash:plan.receiptHash,approve:false},403);
  await request(`/api/support/plans/${plan.id}`,{operation:"execute",receiptHash:plan.receiptHash,approve:true});executed=true;
  const dashboard=await request("/api/support") as SupportDashboard;
  assert.ok(dashboard.outbox.some(message=>message.planId===plan!.id&&message.status==="queued"));
  await request(`/api/support/plans/${plan.id}`,{operation:"recover",receiptHash:plan.receiptHash,approve:false});recovered=true;
  const after=await request("/api/support") as SupportDashboard;
  assert.ok(after.outbox.some(message=>message.planId===plan!.id&&message.status==="cancelled"));
  const report={checkedAt:new Date().toISOString(),liveTinyFish:true,referenceDraft:true,noLlm:true,evidenceHashVerified:true,approvalRequired:true,replyPersisted:true,recovered:true,observer:plan.observer?.status??"unknown",published:false};
  await writeFile("output/tinyfish-reference-check.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{
  if(plan&&!recovered)await request(`/api/support/plans/${plan.id}`,{operation:executed?"recover":"reject",receiptHash:plan.receiptHash,approve:false});
}
