#!/usr/bin/env node
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outdir = resolve(root, "dist", "daemon-bundle");

await mkdir(outdir, { recursive: true });

await build({
  entryPoints: [resolve(root, "src", "daemon", "standalone.ts")],
  outfile: resolve(outdir, "standalone.js"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  banner: {
    js: 'import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);'
  },
  sourcemap: false,
  logLevel: "info"
});

console.log(`daemon bundle written to ${resolve(outdir, "standalone.js")}`);
