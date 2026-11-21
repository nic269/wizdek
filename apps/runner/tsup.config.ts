import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  entry: ["src/index.ts"],
  format: ["cjs"],
  noExternal: [/^@repo\//],
  outDir: "dist",
  sourcemap: false,
  splitting: false,
  target: "node22",
});
