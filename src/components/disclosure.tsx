"use client";
import { useState } from "react";

/** <details> dont l'état ouvert/fermé survit aux re-rendus serveur (après une action). */
export function Disclosure({ summary, defaultOpen = false, children, className }: { summary: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className={className} open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-sm font-medium text-zinc-200">{summary}</summary>
      {children}
    </details>
  );
}
