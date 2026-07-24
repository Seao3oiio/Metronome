import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { writeFile } from "node:fs/promises";

const pagesBase = process.env.PAGES_BASE || "/";
const pwaId = process.env.PWA_ID || "/Metronome/";
const isDevPages = pagesBase === "/Metronome-dev/";
const socialImageUrl =
  `https://seao3oiio.github.io${pagesBase}kessoku-beat-hitori-social.png`;

function devServiceWorkerCleanup() {
  return {
    name: "dev-service-worker-cleanup",
    apply: "build",
    closeBundle: {
      order: "post",
      async handler() {
        if (!isDevPages) return;
        await writeFile(
          new URL("./dist/sw.js", import.meta.url),
          `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await self.registration.unregister();
    const clients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    await Promise.all(clients.map((client) => client.navigate(client.url)));
  })());
});
`,
        );
      },
    },
  };
}

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
      injectRegister: isDevPages ? false : "auto",
      includeAssets: [
        "icon.svg",
        "apple-touch-icon.png",
        "Bravura-OFL.txt",
        "kessoku-beat-hitori-banner.webp",
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
    devServiceWorkerCleanup(),
  ],
});
