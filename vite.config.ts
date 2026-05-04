import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
/// <reference types="vitest" />

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // Path aliases
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@/bindings": resolve(__dirname, "./src/bindings.ts"),
    },
  },

  // Multiple entry points for main app and overlay
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: {
        site: "index.html",
        desktop: "desktop/index.html",
        overlay: "src/overlay/index.html",
        agent: "src/agent/index.html",
      },
      output: {
        manualChunks(id) {
          const localeMatch = id.match(/[\\/]src[\\/]i18n[\\/]locales[\\/](.+?)[\\/]translation\.json$/);
          if (localeMatch) {
            return `locale-${localeMatch[1]}`;
          }

          if (id.includes("src/bindings.ts")) {
            return "bindings";
          }

          if (id.includes("@tauri-apps/api") || id.includes("@tauri-apps/plugin-")) {
            return "vendor-tauri";
          }

          if (
            id.includes("react-dom") ||
            id.includes("react/jsx-runtime") ||
            id.includes("scheduler") ||
            /[\\/]node_modules[\\/]react[\\/]/.test(id)
          ) {
            return "vendor-react";
          }

          if (
            id.includes("i18next") ||
            id.includes("react-i18next") ||
            /[\\/]src[\\/]i18n[\\/]/.test(id)
          ) {
            return "vendor-i18n";
          }

          if (
            id.includes("zustand") ||
            id.includes("immer") ||
            id.includes("sonner") ||
            id.includes("lucide-react")
          ) {
            return "vendor-ui";
          }
        },
      },
    },
  },

  // Vitest configuration
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      // Exclude generated bindings, test helpers, and entry points.
      exclude: [
        "src/bindings.ts",
        "src/test/**",
        "src/**/*.d.ts",
        "src/main.tsx",
        "src/overlay/main.tsx",
        "src/overlay/index.html",
      ],
      // Minimum thresholds enforced in CI via `bun run test:coverage`.
      thresholds: {
        statements: 40,
        branches: 35,
        functions: 40,
        lines: 40,
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
