"use client";
import Link from "next/link";
import { ActionForm, Submit } from "./action-form";
import type { ActionState } from "@/app/actions";

export function AuthCard({ mode, action }: { mode: "login" | "register"; action: (s: ActionState, f: FormData) => Promise<ActionState> }) {
  const reg = mode === "register";
  return (
    <div className="grid min-h-screen place-items-center bg-[radial-gradient(ellipse_at_top,rgba(56,189,248,0.10),transparent_60%)] px-4">
      <div className="w-full max-w-sm animate-fadein">
        <div className="mb-8 flex items-center justify-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-sky-200 to-sky-500 font-bold text-zinc-950">G</span>
          <span className="text-lg font-semibold tracking-tight">Glacier</span>
        </div>
        <div className="card p-6">
          <h1 className="text-lg font-semibold">{reg ? "Créer un compte" : "Connexion"}</h1>
          <p className="sub mt-1">{reg ? "Product research Vinted et comptabilité, au même endroit." : "Accédez à votre tableau de bord."}</p>
          <ActionForm action={action} className="mt-5 space-y-3">
            {reg && <div><label className="label" htmlFor="name">Nom (facultatif)</label><input className="input" id="name" name="name" /></div>}
            <div><label className="label" htmlFor="email">Email</label><input className="input" id="email" name="email" type="email" required autoComplete="email" /></div>
            <div><label className="label" htmlFor="password">Mot de passe</label><input className="input" id="password" name="password" type="password" required minLength={8} autoComplete={reg ? "new-password" : "current-password"} /></div>
            <Submit className="w-full">{reg ? "Créer mon compte" : "Se connecter"}</Submit>
          </ActionForm>
        </div>
        <p className="mt-4 text-center text-sm text-muted">
          {reg ? <>Déjà inscrit ? <Link className="text-ice hover:underline" href="/login">Se connecter</Link></> : <>Pas de compte ? <Link className="text-ice hover:underline" href="/register">Créer un compte</Link></>}
        </p>
      </div>
    </div>
  );
}
