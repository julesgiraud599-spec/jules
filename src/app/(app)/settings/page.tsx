import { requireUser } from "@/lib/auth";
import { aiConfigured } from "@/lib/ai";
import { aliexpressConfigured } from "@/lib/aliexpress";
import { PageHeader, Section } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { updateSettingsAction, changePasswordAction, testWebhookAction } from "@/app/actions";

export default async function Settings() {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="Paramètres" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Calculs et sélection quotidienne">
          <ActionForm action={updateSettingsAction} className="space-y-4">
            <div><label className="label">Nom</label><input name="name" defaultValue={user.name ?? ""} className="input" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Taux de cotisations (%)</label><input name="contributionRate" type="number" step="0.1" min="0" max="100" defaultValue={user.contributionRate} className="input" /><p className="mt-1 text-[11px] text-zinc-500">Micro-entreprise, vente de marchandises. Vérifiez le taux en vigueur sur urssaf.fr.</p></div>
              <div><label className="label">Emballage par vente (€)</label><input name="packagingCost" type="number" step="0.01" min="0" defaultValue={user.packagingCost} className="input" /></div>
              <div><label className="label">Délai avant re-proposition (jours)</label><input name="repeatCooldownDays" type="number" min="0" defaultValue={user.repeatCooldownDays} className="input" /></div>
              <div><label className="label">Score minimum (sélection)</label><input name="minDailyScore" type="number" min="0" max="100" defaultValue={user.minDailyScore} className="input" /></div>
            </div>
            <div><label className="label">Webhook de notification (Discord, Slack ou ntfy.sh)</label><input name="webhookUrl" type="url" defaultValue={user.webhookUrl ?? ""} className="input" placeholder="https://discord.com/api/webhooks/… ou https://ntfy.sh/mon-sujet" /></div>
            <Submit>Enregistrer</Submit>
          </ActionForm>
          {user.webhookUrl && <ActionForm action={testWebhookAction} className="mt-3"><Submit variant="ghost" className="btn-sm">Envoyer une notification de test</Submit></ActionForm>}
        </Section>
        <div className="space-y-6">
          <Section title="Intégrations (variables d'environnement)">
            <ul className="space-y-3 text-sm">
              <li className="flex justify-between gap-3"><span>API AliExpress Affiliés<div className="text-xs text-muted">ALIEXPRESS_APP_KEY, ALIEXPRESS_APP_SECRET, ALIEXPRESS_TRACKING_ID</div></span><span className={aliexpressConfigured() ? "text-emerald-300" : "text-muted"}>{aliexpressConfigured() ? "Actif" : "Inactif"}</span></li>
              <li className="flex justify-between gap-3"><span>Analyse IA (Claude)<div className="text-xs text-muted">ANTHROPIC_API_KEY</div></span><span className={aiConfigured() ? "text-emerald-300" : "text-muted"}>{aiConfigured() ? "Actif" : "Inactif"}</span></li>
              <li className="flex justify-between gap-3"><span>Temu / SHEIN<div className="text-xs text-muted">Pas d&apos;API publique de catalogue, offres saisies à la main</div></span><span className="text-muted">Manuel</span></li>
              <li className="flex justify-between gap-3"><span>Vinted<div className="text-xs text-muted">Pas d&apos;API publique, annonces relevées par vous (saisie ou import CSV)</div></span><span className="text-muted">Manuel</span></li>
            </ul>
          </Section>
          <Section title="Mot de passe">
            <ActionForm action={changePasswordAction} resetOnSuccess className="space-y-3">
              <input name="current" type="password" placeholder="Mot de passe actuel" required className="input" autoComplete="current-password" />
              <input name="next" type="password" placeholder="Nouveau mot de passe" required minLength={8} className="input" autoComplete="new-password" />
              <Submit variant="ghost">Modifier</Submit>
            </ActionForm>
          </Section>
        </div>
      </div>
    </>
  );
}
