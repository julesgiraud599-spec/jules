import { PageHeader, Section } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { createProductAction } from "@/app/actions";
import { CATEGORIES } from "@/lib/format";

export default function NewResearch() {
  return (
    <>
      <PageHeader title="Nouvelle recherche produit" subtitle="Étape 1 : décrivez le produit repéré sur Vinted. Vous ajouterez ensuite les annonces observées et les offres fournisseurs." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Section title="Produit" className="lg:col-span-2">
          <ActionForm action={createProductAction} className="space-y-4">
            <div><label className="label" htmlFor="name">Nom du produit *</label><input id="name" name="name" required className="input" placeholder="Ex. Pince à cheveux XXL effet écaille" /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className="label" htmlFor="category">Catégorie</label><select id="category" name="category" className="input">{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
              <div><label className="label" htmlFor="keywords">Mots-clés de recherche</label><input id="keywords" name="keywords" className="input" placeholder="pince cheveux xxl écaille" /></div>
            </div>
            <div><label className="label" htmlFor="imageUrl">URL de la photo (facultatif)</label><input id="imageUrl" name="imageUrl" type="url" className="input" placeholder="https://…" /></div>
            <div><label className="label" htmlFor="notes">Notes</label><textarea id="notes" name="notes" rows={3} className="input" /></div>
            <Submit>Créer et continuer</Submit>
          </ActionForm>
        </Section>
        <Section title="Méthode">
          <ol className="list-decimal space-y-2 pl-4 text-sm text-muted">
            <li>Repérez sur Vinted un article <b className="text-zinc-200">sans marque</b> avec beaucoup de favoris ou marqué « Vendu ».</li>
            <li>Créez la fiche, puis ajoutez 3 annonces similaires ou plus (lien, prix, favoris, statut).</li>
            <li>Relevez le nombre d&apos;annonces affiché par la recherche Vinted, c&apos;est votre concurrence.</li>
            <li>Liez le produit fournisseur (AliExpress automatique si l&apos;API est configurée, sinon Temu, SHEIN ou AliExpress à la main).</li>
            <li>Remettez les favoris à jour quelques jours plus tard pour mesurer l&apos;évolution de la demande.</li>
          </ol>
        </Section>
      </div>
    </>
  );
}
