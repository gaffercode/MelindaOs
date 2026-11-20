import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts", "app/**/*.{ts,tsx}", "components/**/*.tsx"],
      reporter: ["text-summary", "text"],
      thresholds: {
        // Public tree only: the director tests that read the real hospital examples stay private, so this floor is what
        // the public tests reach. The private repository keeps 95/95/85/90 (dashboard/vitest.config.ts there).
        "lib/director/director-*.ts": { lines: 92, functions: 90, branches: 78, statements: 86 },
        "lib/note-polish.ts": { lines: 100, functions: 75, branches: 94, statements: 93 },
        "lib/phi-guard.ts": { lines: 100, functions: 100, branches: 100, statements: 100 },
        "lib/repository.ts": { lines: 82, functions: 91, branches: 56, statements: 77 },
      },
    },
  },
});
