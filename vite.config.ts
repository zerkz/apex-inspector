import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { resolve } from "path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: "manifest.json", dest: "." },
        { src: "icon16.png", dest: "." },
        { src: "icon32.png", dest: "." },
        { src: "icon48.png", dest: "." },
        { src: "icon128.png", dest: "." },
        { src: "devtools.html", dest: "." },
        { src: "devtools.js", dest: "." },
      ],
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        options: resolve(__dirname, "options.html"),
        panel: resolve(__dirname, "panel.html"),
        devtools: resolve(__dirname, "devtools.html"),
      },
      output: {
        entryFileNames: "[name].js",
      },
    },
  },
});
