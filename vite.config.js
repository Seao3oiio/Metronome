import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const pagesBase = process.env.PAGES_BASE || "/";
const pwaId = process.env.PWA_ID || "/Metronome/";
const socialImageUrl =
  `https://seao3oiio.github.io${pagesBase}kessoku-beat-hitori-social.png`;

export default defineConfig({
  base: pagesBase,
  plugins: [
    {
      name: "kessoku-social-meta",
      transformIndexHtml(html) {
        return html.replaceAll("%SOCIAL_IMAGE_URL%", socialImageUrl);
      },
    },
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "icon.svg",
        "apple-touch-icon.png",
        "Bravura-OFL.txt",
        "kessoku-beat-hitori-social.png",
        "ZCOOL-KuaiLe-OFL.txt",
      ],
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,ttf,txt}"],
      },
      manifest: {
        name: "KESSOKU BEAT",
        short_name: "KESSOKU",
        description: "支持自定义节奏、自动变速和随机空拍的乐队练习节拍器",
        lang: "zh-CN",
        id: pwaId,
        theme_color: "#ff4f9a",
        background_color: "#f8e8df",
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
