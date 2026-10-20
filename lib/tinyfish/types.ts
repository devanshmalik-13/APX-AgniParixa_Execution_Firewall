import { z } from "zod";

export const webSources = [
  { id: "stripe-refunds", title: "Stripe · Refunds reference", url: "https://docs.stripe.com/refunds" },
  { id: "stripe-credit-notes", title: "Stripe · Credit notes reference", url: "https://docs.stripe.com/invoicing/dashboard/credit-notes" },
] as const;
export const webEvidenceSchema = z.object({
  id: z.string().uuid(), provider: z.literal("tinyfish"), api: z.literal("fetch"), trust: z.literal("untrusted_web"),
  sourceId: z.enum(["stripe-refunds", "stripe-credit-notes"]), url: z.string().url(), finalUrl: z.string().url(),
  title: z.string().max(180), text: z.string().min(1).max(8000), fetchedAt: z.string().datetime(), expiresAt: z.string().datetime(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), truncated: z.boolean(),
}).strict();
export type WebEvidence = z.infer<typeof webEvidenceSchema>;
export const webFetchSchema = z.object({ ticketId: z.string().min(1).max(100), sourceId: z.enum(["stripe-refunds", "stripe-credit-notes"]),
  apiKey: z.string().trim().min(10).max(512).regex(/^[\x21-\x7e]+$/).optional() }).strict();

export function webSource(id: string) { return webSources.find(source => source.id === id); }
export function sourceMatches(sourceId: string, value: string) {
  try {
    const source = webSource(sourceId), url = new URL(value);
    return !!source && !url.username && !url.password && !url.search && !url.hash && url.href.replace(/\/$/, "") === source.url;
  } catch { return false; }
}
