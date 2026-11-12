import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppSetup } from "./pwa-setup";

export const metadata: Metadata = {
  title: "BarberQueue — Tu turno, sin esperar de más",
  description: "Toma tu turno, sigue la fila en vivo y activa los avisos de la app.",
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "BarberQueue", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
};
export const viewport: Viewport = { themeColor: "#09090b" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body className="bg-zinc-950 text-zinc-100"><AppSetup />{children}</body></html>;
}
