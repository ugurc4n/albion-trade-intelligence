import type { Metadata } from "next";
import { AvalonView } from "@/components/avalon-view";
import avalonJson from "@/data/avalon.json";
import type { AvalonDataFile } from "@/lib/avalon/types";

export const metadata: Metadata = { title: "Avalon Yolları · Albion Trade Intelligence" };

const data = avalonJson as AvalonDataFile;

export default function AvalonPage() {
  return <AvalonView zones={data.zones} generatedAt={data.generatedAt} />;
}
