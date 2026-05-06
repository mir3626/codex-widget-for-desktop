#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outdir = resolve(process.env.CODEX_WIDGET_PTY_RUNTIME_OUT_DIR?.trim() || join(root, "dist", "pty-runtime"));
const packageDir = resolve(process.env.CODEX_WIDGET_PTY_PACKAGE_DIR?.trim() || join(root, "node_modules", "node-pty"));
const addonApiDir = resolve(root, "node_modules", "node-addon-api");

assertSafeOutputDirectory(outdir);
assertDirectory(packageDir, "node-pty package");

rmSync(outdir, { recursive: true, force: true });
mkdirSync(join(outdir, "node_modules"), { recursive: true });

const nodePtyRuntime = copyNodePtyRuntime(packageDir, join(outdir, "node_modules", "node-pty"));
if (existsSync(addonApiDir)) {
  copyPackageMetadata(addonApiDir, join(outdir, "node_modules", "node-addon-api"));
}

const packageJson = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
const manifest = {
  engine: "node-pty",
  available: nodePtyRuntime.available,
  package: "node-pty",
  version: packageJson.version,
  platform: process.platform,
  arch: process.arch,
  modules: ["node-pty", existsSync(addonApiDir) ? "node-addon-api" : null].filter(Boolean),
  reason: nodePtyRuntime.reason,
  preparedAt: new Date().toISOString()
};
writeFileSync(join(outdir, "pty-runtime.json"), JSON.stringify(manifest, null, 2));
if (manifest.available) {
  console.log(`pty runtime prepared at ${outdir} (${manifest.package}@${manifest.version})`);
} else {
  console.log(`pty runtime unavailable at ${outdir}: ${manifest.reason}`);
}

function copyPackageMetadata(source, target) {
  mkdirSync(target, { recursive: true });
  copyFileSync(join(source, "package.json"), join(target, "package.json"));
}

function copyNodePtyRuntime(source, target) {
  copyPackageMetadata(source, target);
  copyFiltered(join(source, "lib"), join(target, "lib"), (path) => {
    const normalized = path.replace(/\\/g, "/");
    return !normalized.endsWith(".map") && !normalized.endsWith(".test.js");
  });
  copyFiltered(join(source, "typings"), join(target, "typings"));

  const platformArch = `${process.platform}-${process.arch}`;
  const prebuildSource = join(source, "prebuilds", platformArch);
  if (!existsSync(prebuildSource) || !statSync(prebuildSource).isDirectory()) {
    const reason = `node-pty prebuild ${platformArch} is not bundled by the installed package`;
    if (process.platform === "win32" || process.env.CODEX_WIDGET_PTY_RUNTIME_STRICT === "1") {
      throw new Error(`${reason}: ${prebuildSource}`);
    }
    return { available: false, reason };
  }
  copyFiltered(prebuildSource, join(target, "prebuilds", platformArch), (path) => !path.toLowerCase().endsWith(".pdb"));
  return { available: true };
}

function copyFiltered(source, target, include = () => true) {
  assertDirectory(source, `runtime source ${source}`);
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isDirectory()) {
      copyFiltered(sourcePath, targetPath, include);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (include(relative(source, sourcePath))) {
      copyFileSync(sourcePath, targetPath);
    }
  }
}

function assertSafeOutputDirectory(dir) {
  if (basename(dir).toLowerCase() !== "pty-runtime") {
    throw new Error(`Refusing to prepare PTY runtime outside a pty-runtime directory: ${dir}`);
  }
}

function assertDirectory(path, label) {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`${label} is not a directory: ${path}`);
  }
}
