import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Glacier — Product Research Vinted", description: "Détectez les produits sans marque à fort potentiel sur Vinted et suivez votre comptabilité." };
export const viewport: Viewport = { themeColor: "#09090b", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
