import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Kuytu",
    short_name: "Kuytu",
    description: "Uçtan uca şifreli sohbet. Telefon numarası yok.",
    lang: "tr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#121110",
    theme_color: "#121110",
    categories: ["social", "communication"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
