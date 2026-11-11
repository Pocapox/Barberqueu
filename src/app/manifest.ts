import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/", name: "BarberQueue", short_name: "BarberQueue",
    description: "Tu turno en la barbería, siempre a mano.",
    start_url: "/", scope: "/", display: "standalone",
    background_color: "#09090b", theme_color: "#09090b", lang: "es",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
