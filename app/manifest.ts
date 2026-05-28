import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: "#0d0f14",
    description: "Agendamento e painel para barbearias.",
    display: "standalone",
    icons: [
      {
        sizes: "any",
        src: "/favicon.ico",
        type: "image/x-icon",
      },
    ],
    name: "BMS Sistema",
    orientation: "portrait",
    scope: "/",
    short_name: "BMS",
    start_url: "/",
    theme_color: "#0d0f14",
  };
}
