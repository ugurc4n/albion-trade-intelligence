import type { Metadata } from "next";
import { OptimizerView } from "@/components/optimizer-view";

export const metadata: Metadata = { title: "Budget Optimizer · Albion Trade Intelligence" };

export default function OptimizerPage() {
  return <OptimizerView />;
}
