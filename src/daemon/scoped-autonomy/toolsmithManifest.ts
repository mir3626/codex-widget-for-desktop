import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type {
  AutonomyGeneratedToolManifest,
  AutonomyGeneratedToolSpec
} from "../../shared/protocol.js";
import { isUnsupportedSpec } from "./toolsmithPlanning.js";
import { redactPath } from "./toolsmithRedaction.js";
import { sha256Bytes } from "./toolsmithShared.js";
import { entrypointNameForSpec, sourceForSpec } from "./toolTemplates.js";

export function materializeSpec(
  runtimeRoot: string,
  spec: AutonomyGeneratedToolSpec,
  input: { iteration: number; forceSmokeFailure?: boolean }
): AutonomyGeneratedToolSpec {
  if (isUnsupportedSpec(spec)) {
    return { ...spec, status: "blocked" };
  }
  const toolDir = join(runtimeRoot, "tools", spec.id);
  mkdirSync(toolDir, { recursive: true });
  const entrypoint = join(toolDir, entrypointNameForSpec(spec));
  const source = sourceForSpec(spec, input.forceSmokeFailure);
  writeFileSync(entrypoint, source, "utf8");
  const sourceHash = sha256Bytes(readFileSync(entrypoint));
  const manifest = createManifest(spec, entrypoint, sourceHash, input.iteration);
  const manifestPath = join(toolDir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  const artifacts: AutonomyGeneratedToolSpec["artifacts"] = [
    {
      role: "entrypoint",
      path: entrypoint,
      mime: "text/javascript",
      size: statSync(entrypoint).size,
      sha256: sourceHash
    },
    {
      role: "manifest",
      path: manifestPath,
      mime: "application/json",
      size: statSync(manifestPath).size,
      sha256: sha256Bytes(readFileSync(manifestPath))
    }
  ];
  return {
    ...spec,
    status: "materialized",
    manifest,
    sourceHash,
    stabilityRating: manifest.stability.rating,
    artifacts,
    updatedAt: new Date().toISOString()
  };
}

export function createSmokeInput(spec: AutonomyGeneratedToolSpec, outputDir: string): Record<string, unknown> {
  if (spec.capability === "browser_download_verify") {
    const fixturePath = join(outputDir, "fixture-download.txt");
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(fixturePath, "download verification fixture\n", "utf8");
    return { outputDir, filePath: fixturePath, minBytes: 8 };
  }
  if (spec.capability === "terminal_generated_tool") {
    return { outputDir, message: "terminal generated tool smoke" };
  }
  if (spec.capability === "local_document_conversion") {
    return {
      title: "Local document conversion smoke",
      outputDir,
      markdown: [
        "# Local document conversion smoke",
        "",
        "This fixture proves Toolsmith can convert supplied Markdown into Markdown and PDF artifacts."
      ].join("\n"),
      pdfRenderer: "builtin"
    };
  }
  return {
    title: "Scoped autonomy smoke report",
    outputDir,
    sourceDocuments: [
      {
        title: "Fixture",
        url: "https://example.com/scoped-autonomy-fixture",
        text: "Codex can generate bounded tools only after permission and smoke checks."
      }
    ],
    urls: [],
    pdfRenderer: "builtin"
  };
}

export function readEntrypointPath(spec: AutonomyGeneratedToolSpec): string | undefined {
  return spec.artifacts.find((artifact) => artifact.role === "entrypoint")?.path;
}

export function mergeManifestIteration(
  manifest: AutonomyGeneratedToolManifest | undefined,
  iteration: number
): AutonomyGeneratedToolManifest | undefined {
  if (!manifest) {
    return undefined;
  }
  return {
    ...manifest,
    provenance: {
      ...manifest.provenance,
      iterations: iteration
    }
  };
}

export function updateManifestStability(
  manifest: AutonomyGeneratedToolManifest | undefined,
  update: Partial<AutonomyGeneratedToolManifest["stability"]>
): AutonomyGeneratedToolManifest | undefined {
  if (!manifest) {
    return undefined;
  }
  return {
    ...manifest,
    stability: {
      ...manifest.stability,
      ...update
    }
  };
}

export function summarizeManifest(manifest: AutonomyGeneratedToolManifest | undefined): Record<string, unknown> {
  if (!manifest) {
    return {};
  }
  return {
    toolId: manifest.toolId,
    capability: manifest.capability,
    entrypoint: redactPath(manifest.entrypoint),
    commandAllowlist: manifest.commandAllowlist,
    dependencies: manifest.dependencies,
    sourceHashes: manifest.provenance.sourceHashes,
    iterations: manifest.provenance.iterations,
    stability: manifest.stability
  };
}

export function rollbackTargetsForTool(tool: AutonomyGeneratedToolSpec): string[] {
  const targets = new Set<string>();
  for (const artifact of tool.artifacts) {
    if (artifact.role === "entrypoint" || artifact.role === "manifest" || artifact.role === "source") {
      targets.add(dirname(artifact.path));
    }
  }
  for (const action of tool.manifest?.rollback ?? []) {
    if (action.type === "delete_path" || action.type === "delete_artifact") {
      targets.add(action.target);
    }
  }
  return [...targets];
}

export function dependencyWorkspaceForSpec(spec: AutonomyGeneratedToolSpec, toolDirectory: string): string | undefined {
  const dependencies = spec.manifest?.dependencies ?? [];
  const needsRuntimeWorkspace = dependencies.some((dependency) =>
    (dependency.source === "npm" || dependency.source === "pip") && dependency.installed !== true
  );
  const workspace = join(toolDirectory, "dependencies");
  return needsRuntimeWorkspace && existsSync(workspace) ? workspace : undefined;
}

function createManifest(
  spec: AutonomyGeneratedToolSpec,
  entrypoint: string,
  sourceHash: string,
  iteration: number
): AutonomyGeneratedToolManifest {
  const commandAllowlist = spec.capability === "terminal_generated_tool" ? ["node", "python", "powershell"] : ["node"];
  const artifactContract = spec.capability === "browser_download_verify"
    ? [{ role: "download_verification", mime: "application/json", required: true }]
    : spec.capability === "terminal_generated_tool"
      ? [
        { role: "stdout", mime: "text/plain", required: true },
        { role: "stdout_json", mime: "application/json", required: true }
      ]
      : spec.capability === "local_document_conversion"
        ? [
          { role: "report", mime: "text/markdown", required: true },
          { role: "pdf", mime: "application/pdf", required: true }
        ]
        : [
        { role: "report", mime: "text/markdown", required: true },
        { role: "pdf", mime: "application/pdf", required: true },
        { role: "citation", mime: "application/json", required: true }
      ];
  return {
    schemaVersion: "autonomy-tool-manifest.v1",
    toolId: spec.id,
    capability: spec.capability,
    entrypoint,
    commandAllowlist,
    dependencies: [
      { name: "node", source: "system", installed: true },
      ...(spec.capability === "web_research_to_pdf" || spec.capability === "local_document_conversion"
        ? [{ name: "pandoc", source: "system" as const, installed: false }]
        : [])
    ],
    smokeCommands: ["smoke"],
    artifactContract,
    rollback: [
      { type: "delete_path", target: dirname(entrypoint) },
      { type: "deactivate_tool", target: spec.id }
    ],
    provenance: {
      generatedBy: spec.templateId.includes("terminal") ? "ad_hoc_generator" : "reviewed_template",
      templateId: spec.templateId,
      sourceHashes: { [basename(entrypoint)]: sourceHash },
      iterations: iteration,
      generatedAt: new Date().toISOString()
    },
    stability: {
      rating: "unknown",
      rerunCount: 0,
      externalDependencyWarnings: spec.capability === "web_research_to_pdf"
        ? ["Live web fetches can vary by network, redirects, and upstream page changes."]
        : spec.capability === "local_document_conversion"
          ? ["Pandoc output can vary by local installation when the pandoc renderer is selected."]
        : []
    }
  };
}
