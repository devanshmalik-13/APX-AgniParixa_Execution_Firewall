import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { writeFile } from "node:fs/promises";
import { TinyFishResearch,WebEvidenceCard } from "../components/tinyfish-research";
import { webSources } from "../lib/tinyfish/types";
const base="http://localhost:5173",headers={origin:base,cookie:"__sites_local_auth=1","content-type":"application/json"};
const checks:string[]=[];
let response=await fetch(base+"/api/tinyfish");assert.equal(response.status,401);checks.push("authenticated access required");
response=await fetch(base+"/api/tinyfish",{headers});assert.equal(response.status,200);
const status=await response.json() as Record<string,unknown>;assert.ok(!Object.hasOwn(status,"apiKey"));checks.push("configuration exposes no key");
for(const body of [{ticketId:"tkt-1044",sourceId:"stripe-refunds",url:"http://127.0.0.1"},{ticketId:"tkt-1044",sourceId:"outside"}]){
 response=await fetch(base+"/api/tinyfish",{method:"POST",headers,body:JSON.stringify(body)});assert.equal(response.status,400);
}
response=await fetch(base+"/api/tinyfish",{method:"POST",headers:{...headers,origin:"https://outside.example"},body:JSON.stringify({ticketId:"tkt-1044",sourceId:"stripe-refunds"})});assert.equal(response.status,403);checks.push("extra fields, unknown sources and cross-origin mutations refused");
response=await fetch(base+"/api/tinyfish/plan",{method:"POST",headers,body:JSON.stringify({ticketId:"tkt-1044",evidenceId:crypto.randomUUID(),profile:"standard"})});assert.equal(response.status,400);
response=await fetch(base+"/api/tinyfish/plan",{method:"POST",headers,body:JSON.stringify({ticketId:"tkt-1044",evidenceId:crypto.randomUUID()})});assert.equal(response.status,404);checks.push("drafting accepts neither caller grants nor missing evidence");
const html=renderToStaticMarkup(createElement(TinyFishResearch,{ticketId:"tkt-1044",disabled:false,liveAvailable:true,evidence:null,onEvidence:()=>{},onBusyChange:()=>{},onDraft:()=>{}}));
assert.ok(html.includes('type="password"'));assert.ok(html.includes("Fetch reference with TinyFish"));checks.push("planner renders secure key field and retrieval control");
const card=renderToStaticMarkup(createElement(WebEvidenceCard,{evidence:{id:crypto.randomUUID(),provider:"tinyfish",api:"fetch",trust:"untrusted_web",sourceId:"stripe-refunds",url:webSources[0].url,finalUrl:webSources[0].url,title:"Reference",text:"<script>alert('unsafe')</script>",fetchedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+900000).toISOString(),sha256:"a".repeat(64),truncated:false}}));
assert.ok(!card.includes("<script>"));assert.ok(card.includes("&lt;script&gt;"));checks.push("reference is displayed as escaped text, never executable HTML");
for(const path of ["/","/support?panel=planner","/evaluation","/lab","/observer"]){response=await fetch(base+path,{headers});assert.equal(response.status,200);}
checks.push("all five workspaces respond successfully");
const report={checkedAt:new Date().toISOString(),passed:true,checks,browserVisualVerification:"Not performed; prior browser URL-policy restriction remains unresolved"};
await writeFile("output/tinyfish-http-check.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report));
