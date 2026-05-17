export const TERMINAL_GENERATED_TOOL = String.raw`
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdin += chunk;
});
process.stdin.on("end", () => {
  try {
    const request = JSON.parse(stdin || "{}");
    const command = typeof request.command === "string" ? request.command : "execute";
    const input = request.input && typeof request.input === "object" ? request.input : {};
    const outputDir = typeof input.outputDir === "string" && input.outputDir ? input.outputDir : process.cwd();
    mkdirSync(outputDir, { recursive: true });
    if (command === "smoke") {
      return writeTerminalOutput(outputDir, { ok: true, stdout: "terminal generated tool smoke\n", stderr: "", exitCode: 0, command: "smoke" });
    }
    if (command !== "execute") {
      return writeJson({ ok: false, error: "unknown_command:" + command });
    }
    if (typeof input.command !== "string" || !input.command.trim()) {
      return writeTerminalOutput(outputDir, { ok: true, stdout: String(input.message || "no command provided") + "\n", stderr: "", exitCode: 0, command: "echo" });
    }
    const allowedPrefixes = Array.isArray(request.allowedCommandPrefixes) ? request.allowedCommandPrefixes : [];
    const deniedPatterns = Array.isArray(request.deniedCommandPatterns) ? request.deniedCommandPatterns : [];
    if (!isAllowed(input.command, allowedPrefixes, deniedPatterns)) {
      return writeJson({ ok: false, error: "command_not_allowed" });
    }
    const parts = splitCommand(input.command);
    const result = spawnSync(parts[0], parts.slice(1), { encoding: "utf8", shell: false, timeout: 30000 });
    return writeTerminalOutput(outputDir, {
      ok: result.status === 0,
      stdout: result.stdout || "",
      stderr: result.stderr || result.error?.message || "",
      exitCode: result.status,
      command: input.command
    });
  } catch (error) {
    writeJson({ ok: false, error: error && error.message ? error.message : String(error) });
    process.exitCode = 1;
  }
});

function writeTerminalOutput(outputDir, payload) {
  const jsonPath = join(outputDir, "stdout.json");
  const textPath = join(outputDir, "stdout.txt");
  writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  writeFileSync(textPath, payload.stdout || "", "utf8");
  writeJson({
    ...payload,
    artifacts: [
      { role: "stdout_json", path: jsonPath, mime: "application/json" },
      { role: "stdout", path: textPath, mime: "text/plain" }
    ]
  });
  if (!payload.ok) {
    process.exitCode = 1;
  }
}

function isAllowed(command, prefixes, deniedPatterns) {
  const normalized = String(command || "").trim().toLowerCase();
  if (!prefixes.some((prefix) => {
    const grant = String(prefix).trim().toLowerCase();
    if (!grant) return false;
    if (grant.endsWith("*")) {
      const base = grant.slice(0, -1).trimEnd();
      return base && (normalized === base || normalized.startsWith(base + " "));
    }
    return normalized === grant || (!/\s/.test(grant) && normalized.startsWith(grant + " "));
  })) {
    return false;
  }
  return !deniedPatterns.some((pattern) => normalized.includes(String(pattern).toLowerCase()));
}

function splitCommand(command) {
  const matches = String(command).match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  return matches.map((part) => part.replace(/^"|"$/g, ""));
}

function writeJson(payload) {
  process.stdout.write(JSON.stringify(payload));
}
`;
