"use client";
import { createContext, startTransition, useActionState, useContext, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/app/actions";
import clsx from "clsx";

const PendingCtx = createContext(false);

/**
 * Formulaire relié à une action serveur. La soumission passe par onSubmit (et non la prop `action`)
 * pour que React ne vide pas les champs quand l'action renvoie une erreur : l'utilisateur garde sa saisie.
 */
export function ActionForm({ action, children, className, resetOnSuccess }: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  children: React.ReactNode; className?: string; resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok && resetOnSuccess) ref.current?.reset(); }, [state, resetOnSuccess]);
  return (
    <PendingCtx.Provider value={pending}>
      <form ref={ref} className={className} onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}>
        {children}
        {state?.error && <p role="alert" className="mt-3 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">{state.error}</p>}
        {state?.ok && state.message && <p role="status" className="mt-3 rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300">{state.message}</p>}
      </form>
    </PendingCtx.Provider>
  );
}

export function Submit({ children, variant = "primary", className, pendingText }: { children: React.ReactNode; variant?: "primary" | "ghost" | "danger"; className?: string; pendingText?: string }) {
  const ctxPending = useContext(PendingCtx);
  const { pending: formPending } = useFormStatus();
  const pending = ctxPending || formPending;
  return (
    <button type="submit" disabled={pending} className={clsx(variant === "primary" ? "btn-primary" : variant === "danger" ? "btn-danger" : "btn-ghost", className)}>
      {pending ? (pendingText ?? "En cours…") : children}
    </button>
  );
}
