"use client";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/app/actions";
import clsx from "clsx";

export function ActionForm({ action, children, className, resetOnSuccess }: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  children: React.ReactNode; className?: string; resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok && resetOnSuccess) ref.current?.reset(); }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      {state?.error && <p role="alert" className="mt-3 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">{state.error}</p>}
      {state?.ok && state.message && <p role="status" className="mt-3 rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300">{state.message}</p>}
    </form>
  );
}

export function Submit({ children, variant = "primary", className, pendingText }: { children: React.ReactNode; variant?: "primary" | "ghost" | "danger"; className?: string; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={clsx(variant === "primary" ? "btn-primary" : variant === "danger" ? "btn-danger" : "btn-ghost", className)}>
      {pending ? (pendingText ?? "En cours…") : children}
    </button>
  );
}
