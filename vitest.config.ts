import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/lib/phone.ts", "src/lib/supabase-client.ts", "src/lib/supabase-admin.ts", "src/lib/whatsapp-auth.ts", "src/lib/whatsapp-client.ts", "src/app/api/**/*.ts"],
      exclude: ["**/*.test.ts"],
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
});
