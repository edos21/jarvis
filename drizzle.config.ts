import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./server/src/schema.ts",
  out: "./server/drizzle",
});
