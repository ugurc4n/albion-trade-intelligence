"use client";

import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ItemIcon } from "@/components/item-icon";
import { TierBadge } from "@/components/badges";
import { Input } from "@/components/ui/input";
import { searchItems } from "@/lib/api-client";
import { categoryLabel } from "@/lib/catalog/types";

/** Jump-to-item search over the local item catalog (no Albion API calls). */
export function ItemSearch() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setTimeout(() => setQuery(text.trim()), 200);
    return () => clearTimeout(id);
  }, [text]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const { data = [] } = useQuery({
    queryKey: ["catalog-search", query],
    queryFn: ({ signal }) => searchItems(query, signal),
    enabled: query.length >= 2,
    staleTime: Infinity,
  });

  const go = (id: string) => {
    setOpen(false);
    setText("");
    router.push(`/item/${encodeURIComponent(id)}`);
  };

  return (
    <div ref={boxRef} className="relative w-full max-w-sm">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, data.length - 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          else if (e.key === "Enter" && data[active]) go(data[active].id);
          else if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Ürün detayına git…"
        className="h-8 pl-8 text-[13px]"
        role="combobox"
        aria-expanded={open && data.length > 0}
        aria-controls="item-search-list"
        aria-label="Ürün ara"
      />
      {open && query.length >= 2 && (
        <ul
          id="item-search-list"
          role="listbox"
          className="absolute top-9 right-0 left-0 z-50 max-h-80 overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-lg"
        >
          {data.length === 0 && <li className="px-3 py-2 text-xs text-muted-foreground">Sonuç yok</li>}
          {data.map((item, i) => (
            <li key={item.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(item.id)}
                className={`flex w-full items-center gap-2 px-2 py-1.5 text-left ${i === active ? "bg-accent" : ""}`}
              >
                <ItemIcon itemId={item.id} size={26} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">{item.nameEn}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {item.id} · {categoryLabel(item.category)}
                  </span>
                </span>
                <TierBadge tier={item.tier} enchant={item.enchant} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
