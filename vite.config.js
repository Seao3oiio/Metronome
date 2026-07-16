import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const pagesBase = process.env.PAGES_BASE || "/";
const pwaId = process.env.PWA_ID || "/Metronome/";

export default defineConfig({
  base: pagesBase,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.png", "Bravura-OFL.txt"],
      manifest: {
        name: "Pulse 练习节拍器",
        short_name: "Pulse",
        description: "准确、易用、支持自定义节奏和变速练习的节拍器",
        lang: "zh-CN",
        id: pwaId,
        theme_color: "#0b0d12",
        background_color: "#0b0d12",
        display: "standalone",
        start_url: pagesBase,
        scope: pagesBase,
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
});
