import { defineConfig } from "vite";

// The built viewer goes inside the Python package, so `windowseat view`
// works with only Python installed. base "./" also makes it work on GitHub Pages.
// Fixed file names (no content hash) so a rebuild overwrites the previous files.
export default defineConfig({
  base: "./",
  worker: { format: "es", rollupOptions: { output: { entryFileNames: "assets/[name].js" } } },
  build: {
    outDir: "../src/windowseat/viewer",
    emptyOutDir: true,
    rollupOptions: {
      output: { entryFileNames: "assets/app.js", chunkFileNames: "assets/[name].js", assetFileNames: "assets/[name][extname]" },
    },
  },
});
