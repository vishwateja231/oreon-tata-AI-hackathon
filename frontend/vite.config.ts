// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  nitro: true,
  vite: {
    build: {
      sourcemap: false,
      cssMinify: true,
      minify: "esbuild",
      rollupOptions: {
        maxParallelFileOps: 2,
        output: {
          manualChunks: (id) => {
            if (id.includes("node_modules")) {
              if (id.includes("three") || id.includes("@react-three")) {
                return "three-bundle";
              }
              if (id.includes("lucide-react") || id.includes("recharts")) {
                return "ui-heavy";
              }
              return "vendor";
            }
          }
        }
      }
    }
  }
});
