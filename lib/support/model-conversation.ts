import { z } from "zod";
import { PlannerProviderError, type PlannerConfig } from "./provider-config";
import { modelProvider, validModel } from "./model-providers";

interface ToolDefinition { name: string; description: string; parameters: Record<string, unknown> }
export interface ModelToolCall { name: string; arguments: string; call_id: string; nativeId?: string }
interface ModelTurn { calls: ModelToolCall[]; summary: string }
const record = z.record(z.unknown());
const openaiItem = z.object({ type: z.string(), name: z.string().optional(), arguments: z.string().optional(), call_id: z.string().optional(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).optional() }).passthrough();
const geminiPart = z.object({ text: z.string().optional(), thought: z.boolean().optional(),
  functionCall: z.object({ name: z.string().min(1).max(128), args: record, id: z.string().optional() }).passthrough().optional() }).passthrough();

/** Bound provider data before parsing; never surface provider bodies or transport diagnostics. */
async function providerJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    await response.body?.cancel();
    const reason = response.status === 429 ? "rate limited or out of quota"
      : response.status === 401 || response.status === 403 ? `authentication or access was rejected (HTTP ${response.status})`
      : `request failed (HTTP ${response.status})`;
    throw new PlannerProviderError(`Model provider ${reason}. No action executed.`);
  }
  if (!response.body) throw new PlannerProviderError("The model returned an empty response. No action executed.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 128_000) { await reader.cancel(); throw new Error("oversized"); }
      chunks.push(value);
    }
    const data = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)) as unknown;
  } catch { throw new PlannerProviderError("The model returned an invalid or oversized response. No action executed."); }
  finally { reader.releaseLock(); }
}

/** Preserve native conversation data (including Gemini thought signatures) only in memory. */
export function modelConversation(config: PlannerConfig & { apiKey: string }, instructions: string, customer: string, tools: ToolDefinition[]) {
  const provider = config.provider ?? "openai";
  const selected = modelProvider(provider);
  if (!selected) throw new PlannerProviderError("Unsupported planner provider. No action executed.");
  if (!validModel(provider, config.model)) throw new PlannerProviderError("Invalid planner model configuration. No action executed.");
  const chat = selected.protocol === "chat";
  const history: unknown[] = provider === "gemini" ? [{ role: "user", parts: [{ text: customer }] }]
    : chat ? [{ role: "system", content: instructions }, { role: "user", content: customer }] : [{ role: "user", content: customer }];
  let resultParts: unknown[] = [];
  let turnIndex = 0;
  return {
    async next(fetcher: typeof fetch, signal: AbortSignal): Promise<ModelTurn> {
      if (provider === "gemini" && resultParts.length) {
        history.push({ role: "user", parts: resultParts });
        resultParts = [];
      }
      const url = provider === "gemini" ? `${selected.endpoint}${config.model}:generateContent` : selected.endpoint;
      const headers: Record<string, string> = provider === "gemini" ? { "Content-Type": "application/json", "x-goog-api-key": config.apiKey } : { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` };
      const body = provider === "gemini" ? {
        systemInstruction: { parts: [{ text: instructions }] }, contents: history,
        tools: [{ functionDeclarations: tools.map(({ name, description, parameters }) => ({ name, description, parametersJsonSchema: parameters })) }],
        toolConfig: { functionCallingConfig: { mode: "AUTO" } }, generationConfig: { candidateCount: 1, maxOutputTokens: 2048 },
      } : chat ? { model: config.model, messages: history, tools: tools.map(({ name, description, parameters }) => ({ type: "function", function: { name, description, parameters } })),
        tool_choice: "auto", parallel_tool_calls: false, max_tokens: 2048, stream: false,
        ...(provider === "openrouter" ? { provider: { require_parameters: true, data_collection: "deny" } } : {}) }
        : { model: config.model, instructions, input: history, tools, parallel_tool_calls: false, max_output_tokens: 2048, store: false };
      // Workers supports manual redirects; reject 3xx without forwarding the credential.
      const response = await fetcher(url, { method: "POST", headers, body: JSON.stringify(body), signal, redirect: "manual" });
      const raw = await providerJson(response);
      if (chat) {
        const parsed = z.object({ choices: z.array(z.object({ finish_reason: z.enum(["stop", "tool_calls"]), message: z.object({ role: z.literal("assistant"), content: z.string().nullable().optional(),
          tool_calls: z.array(z.object({ id: z.string().min(1), type: z.literal("function"), function: z.object({ name: z.string().min(1), arguments: z.string() }) })).max(12).optional() }) })).length(1) }).safeParse(raw);
        if (!parsed.success) throw new PlannerProviderError("The model returned an incomplete or malformed tool response. No action executed.");
        const message = parsed.data.choices[0].message;
        history.push(message);
        return { calls: (message.tool_calls ?? []).map((call) => ({ call_id: call.id, name: call.function.name, arguments: call.function.arguments })), summary: message.content ?? "" };
      }
      if (provider === "gemini") {
        const parsed = z.object({ candidates: z.array(z.object({ finishReason: z.literal("STOP"),
          content: z.object({ role: z.literal("model"), parts: z.array(geminiPart).min(1) }).passthrough() })).length(1) }).safeParse(raw);
        if (!parsed.success) throw new PlannerProviderError("The model returned an incomplete, blocked, or malformed response. No action executed.");
        const content = parsed.data.candidates[0].content;
        history.push(content);
        turnIndex++;
        return { calls: content.parts.flatMap((part, index) => part.functionCall ? [{ name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args), call_id: part.functionCall.id ?? `gemini-${turnIndex}-${index}`,
          ...(part.functionCall.id ? { nativeId: part.functionCall.id } : {}) }] : []),
          summary: content.parts.filter((part) => !part.thought).map((part) => part.text ?? "").join("\n") };
      }
      const parsed = z.object({ output: z.array(openaiItem), status: z.string().optional() }).safeParse(raw);
      if (!parsed.success || (parsed.data.status !== undefined && parsed.data.status !== "completed")) throw new PlannerProviderError("The model returned an incomplete response. No action executed.");
      history.push(...parsed.data.output);
      const calls = parsed.data.output.filter((item) => item.type === "function_call").map((item) => {
        if (!item.call_id || !item.name || typeof item.arguments !== "string") throw new PlannerProviderError("The model returned a malformed tool call. No action executed.");
        return { name: item.name, arguments: item.arguments, call_id: item.call_id };
      });
      return { calls, summary: parsed.data.output.filter((item) => item.type === "message").flatMap((item) => item.content ?? [])
        .filter((item) => item.type === "output_text").map((item) => item.text ?? "").join("\n") };
    },
    result(call: ModelToolCall, result: Record<string, unknown>) {
      if (provider === "gemini") resultParts.push({ functionResponse: { name: call.name, response: result,
        ...(call.nativeId ? { id: call.nativeId } : {}) } });
      else if (chat) history.push({ role: "tool", tool_call_id: call.call_id, content: JSON.stringify(result) });
      else history.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) });
    },
  };
}
