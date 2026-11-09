import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BarberQueue — Tu turno, sin esperar de más",
  description: "Toma tu turno, sigue la fila en vivo y recibe tu aviso por WhatsApp.",
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body className="bg-zinc-950 text-zinc-100">{children}</body></html>;
}
