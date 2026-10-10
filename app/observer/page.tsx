import type { Metadata } from "next";
import { ObserverWorkspace } from "@/components/observer-workspace";
import "./observer.css";

export const metadata: Metadata = {
  title: "APX — Security observer",
  description: "Inspect small-model prompt-injection observations without changing task permissions or required approvals.",
};

export default function ObserverPage() {
  return <ObserverWorkspace />;
}
