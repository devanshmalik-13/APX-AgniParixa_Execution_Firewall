import type { Metadata } from "next";
import { CombinationWorkspace } from "@/components/combination-workspace";
import "./evaluation.css";

export const metadata: Metadata = {
  title: "APX — Compare execution defenses",
  description: "Inspect reproducible action-policy comparisons, their limitations, and the execution architecture selected for APX.",
};

export default function EvaluationPage() {
  return <CombinationWorkspace />;
}
