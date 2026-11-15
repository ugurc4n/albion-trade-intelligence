import type { Metadata } from "next";
import { OptimizerView } from "@/components/optimizer-view";

export const metadata: Metadata = { title: "Bütçe Optimizer · Albion Trade Intelligence" };

export default function OptimizerPage() {
  return <OptimizerView />;
}
