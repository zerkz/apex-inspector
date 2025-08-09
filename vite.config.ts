import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// https://vitejs.dev/config/
export default defineConfig({
  base: './', // Critical for Chrome extensions - use relative paths
  plugins: [react()],
  build: {
    assetsInlineLimit: 0, // Prevent inlining assets for better debugging
    outDir: 'dist',
    rollupOptions: {
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js', 
        assetFileNames: '[name].[ext]'
      },
      external: [
        // These are static files that will be copied from public directory
        './devtools.js'
      ],
      input: {
        // Entry points for each HTML page in the extension
        options: resolve(__dirname, "options.html"),
        panel: resolve(__dirname, "panel.html"),
        devtools: resolve(__dirname, "devtools.html"),
      },
    },
  },
  // Let Vite handle the public directory automatically
  publicDir: 'public',
});
