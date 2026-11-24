import { describe, it, expect } from "vitest";
import { computeMatch, colorsOf, dimensionsOf } from "@/lib/matching";

describe("correspondance Vinted / fournisseur", () => {
  it("extrait couleurs et dimensions", () => {
    expect([...colorsOf("Pince écaille marron et noire")].sort()).toEqual(["marron", "noir"]);
    expect(dimensionsOf("Pince 13cm, sac 25 x 18 cm, perle 8 mm")).toEqual([13, 18, 0.8]);
  });
  it("sans comparaison visuelle, une correspondance textuelle reste incertaine", () => {
    const m = computeMatch({ vintedTitles: ["Pince à cheveux XXL écaille 13 cm"], supplierTitle: "Grande pince à cheveux écaille 13cm acétate" });
    expect(m.status).toBe("UNCERTAIN");
    expect(m.score).toBeGreaterThan(70);
  });
  it("verdict visuel « identique » + texte cohérent → même produit", () => {
    const m = computeMatch({ vintedTitles: ["Pince à cheveux XXL écaille"], supplierTitle: "Pince crabe écaille grande taille", visual: { verdict: "identique", confiance: 92, raisons: "même forme" } });
    expect(m.status).toBe("MATCH");
  });
  it("verdict visuel « différent » → rejeté, même si le titre est proche", () => {
    const m = computeMatch({ vintedTitles: ["Pince à cheveux XXL écaille"], supplierTitle: "Pince à cheveux XXL écaille", visual: { verdict: "different", confiance: 90, raisons: "autre modèle" } });
    expect(m.status).toBe("REJECTED");
  });
  it("couleurs incompatibles et titre éloigné → rejeté", () => {
    expect(computeMatch({ vintedTitles: ["Sac bandoulière noir"], supplierTitle: "Pochette rose à paillettes" }).status).toBe("REJECTED");
  });
  it("dimensions très différentes pénalisent", () => {
    const a = computeMatch({ vintedTitles: ["Pince écaille 13 cm"], supplierTitle: "Pince écaille 13cm" });
    const b = computeMatch({ vintedTitles: ["Pince écaille 13 cm"], supplierTitle: "Pince écaille 5cm" });
    expect(a.score!).toBeGreaterThan(b.score!);
  });
  it("confirmation de l'utilisateur → même produit", () => {
    expect(computeMatch({ vintedTitles: ["Écharpe à franges"], supplierTitle: "Scarf tassel winter", userConfirmed: true }).status).toBe("MATCH");
  });
});
