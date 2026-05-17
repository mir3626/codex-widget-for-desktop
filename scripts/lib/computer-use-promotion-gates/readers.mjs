import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function readJsonIfExists(path) {
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

export function readDatedEvidence(root, pattern, fileName) {
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const match = pattern.exec(entry.name);
      if (!match) {
        return null;
      }
      const path = join(root, entry.name, fileName);
      if (!existsSync(path)) {
        return null;
      }
      return {
        date: match[1],
        path: path.replace(/\\/g, "/"),
        data: JSON.parse(readFileSync(path, "utf8"))
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function readLiveSampleLedger(path) {
  if (!existsSync(path)) {
    return { path: path.replace(/\\/g, "/"), samples: [] };
  }
  const samples = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((sample) => sample && typeof sample === "object" && sample.scenario && typeof sample.scenario === "object");
  return {
    path: path.replace(/\\/g, "/"),
    samples
  };
}

export function readBrowserActionSemanticLiveCorpus(path) {
  if (!existsSync(path)) {
    return { path: path.replace(/\\/g, "/"), entries: [] };
  }
  const entries = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((entry) => entry && typeof entry === "object");
  return {
    path: path.replace(/\\/g, "/"),
    entries
  };
}

export function readBrowserActionReportRow(reportPath, scenarioId) {
  if (typeof reportPath !== "string" || typeof scenarioId !== "string" || !existsSync(reportPath)) {
    return null;
  }
  const report = readFileSync(reportPath, "utf8");
  for (const line of report.split(/\r?\n/)) {
    if (!line.startsWith("|") || !line.includes(scenarioId)) {
      continue;
    }
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells[0] === scenarioId) {
      return {
        scenario: cells[0],
        mode: cells[1],
        status: cells[2],
        failureClass: cells[3],
        elapsedMs: Number(cells[4])
      };
    }
  }
  return null;
}
