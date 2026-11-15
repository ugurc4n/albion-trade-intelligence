import { Suspense } from "react";
import { ItemDetailView } from "@/components/item-detail-view";

export default function ItemPage() {
  return (
    <Suspense>
      <ItemDetailView />
    </Suspense>
  );
}
