#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  evaluateBrowserActionRecoveryCorpusGate,
  evaluateBrowserActionSemanticCorpusGate,
  evaluateBrowserBridgeRestrictedReloadBoundaryGate,
  evaluateBrowserChromeDeepActionEvidenceUxGate,
  evaluateBrowserChromeLiveExtensionDogfoodGate,
  evaluateBrowserChromePublicExtensionDogfoodGate,
  evaluateBrowserChromeRepeatedDogfoodGate,
  evaluateComputerSessionBrowserPromptDogfoodGate,
  evaluateComputerSessionBrowserPromptLiveGate,
  evaluateFutureVmSandboxBoundaryGate,
  evaluateLiveTaskBenchmarkHarnessGate,
  evaluateLiveWebResearchGate,
  evaluateProcessValidationGate,
  evaluateRendererPermissionProfileUxGate,
  evaluateScopedAutonomyGeneratedToolLiveBreadthGate,
  evaluateScopedAutonomyNpmDependencyDogfoodGate,
  evaluateScopedAutonomySelfImplementationBreadthGate,
  evaluateWindowsNativeWatchBoundaryGate,
  evaluateWindowsSettingsReversibleDogfoodBoundaryGate,
  localDateString,
  readBrowserActionSemanticLiveCorpus,
  readDatedEvidence,
  readJsonIfExists,
  readLiveSampleLedger,
  renderReport,
  summarizeGates
} from "./lib/computer-use-promotion-gates.mjs";

const dryRun = process.argv.includes("--dry-run");
const printJson = process.argv.includes("--json");
const evidenceDate = process.env.COMPUTER_USE_PROMOTION_GATE_DATE || localDateString();
const reportDir = join("docs", "reports");
const assetDir = join(reportDir, "assets", `computer-use-promotion-gate-${evidenceDate}`);
const evidencePath = join(assetDir, "evidence.json");
const reportPath = join(reportDir, `computer-use-promotion-gate-${evidenceDate}.md`);

const processRuns = readDatedEvidence("docs/reports/assets", /^computer-use-process-validation-30-(\d{4}-\d{2}-\d{2})$/, "evidence.json");
const scopedLiveRuns = readDatedEvidence("docs/reports/assets", /^scoped-autonomy-web-research-live-(\d{4}-\d{2}-\d{2})$/, "evidence.json");
const computerLiveRuns = readDatedEvidence("docs/reports/assets", /^computer-use-toolsmith-live-(\d{4}-\d{2}-\d{2})$/, "evidence.json");
const computerBrowserPromptRuns = readDatedEvidence("docs/reports/assets", /^computer-use-browser-prompt-dogfood-(\d{4}-\d{2}-\d{2})$/, "evidence.json");
const computerBrowserPromptLiveRuns = readDatedEvidence("docs/reports/assets", /^computer-use-browser-prompt-live-(\d{4}-\d{2}-\d{2})$/, "evidence.json");
const computerBrowserChromeDogfoodRuns = readDatedEvidence("docs/reports/assets", /^computer-use-browser-chrome-dogfood-(\d{4}-\d{2}-\d{2})$/, "evidence.json");
const computerBrowserChromeLiveExtensionRuns = readDatedEvidence("docs/reports/assets", /^computer-use-browser-chrome-live-extension-(\d{4}-\d{2}-\d{2})$/, "evidence.json");
const computerBrowserChromePublicExtensionRuns = readDatedEvidence("docs/reports/assets", /^computer-use-browser-chrome-public-extension-(\d{4}-\d{2}-\d{2})$/, "evidence.json");
const computerUseLiveTaskBenchmarkRuns = readDatedEvidence("docs/reports/assets", /^computer-use-live-task-benchmark-(\d{4}-\d{2}-\d{2})$/, "evidence.json");
const scopedAutonomySelfImplementationRuns = readDatedEvidence("docs/reports/assets", /^scoped-autonomy-self-implementation-(\d{4}-\d{2}-\d{2})$/, "evidence.json");
const scopedAutonomyGeneratedToolLiveBreadthRuns = readDatedEvidence("docs/reports/assets", /^scoped-autonomy-generated-tool-live-breadth-(\d{4}-\d{2}-\d{2})$/, "evidence.json");
const scopedAutonomyNpmDependencyRuns = readDatedEvidence("docs/reports/assets", /^scoped-autonomy-npm-dependency-(\d{4}-\d{2}-\d{2})$/, "evidence.json");
const scopedLiveSamples = readLiveSampleLedger(join("docs", "reports", "assets", "scoped-autonomy-web-research-live-runs.jsonl"));
const computerLiveSamples = readLiveSampleLedger(join("docs", "reports", "assets", "computer-use-toolsmith-live-runs.jsonl"));
const computerBrowserPromptLiveSamples = readLiveSampleLedger(join("docs", "reports", "assets", "computer-use-browser-prompt-live-runs.jsonl"));
const computerBrowserChromeDogfoodSamples = readLiveSampleLedger(join("docs", "reports", "assets", "computer-use-browser-chrome-dogfood-runs.jsonl"));
const computerBrowserChromeLiveExtensionSamples = readLiveSampleLedger(join("docs", "reports", "assets", "computer-use-browser-chrome-live-extension-runs.jsonl"));
const computerBrowserChromePublicExtensionSamples = readLiveSampleLedger(join("docs", "reports", "assets", "computer-use-browser-chrome-public-extension-runs.jsonl"));
const scopedAutonomySelfImplementationSamples = readLiveSampleLedger(join("docs", "reports", "assets", "scoped-autonomy-self-implementation-runs.jsonl"));
const scopedAutonomyGeneratedToolLiveBreadthSamples = readLiveSampleLedger(join("docs", "reports", "assets", "scoped-autonomy-generated-tool-live-breadth-runs.jsonl"));
const scopedAutonomyNpmDependencySamples = readLiveSampleLedger(join("docs", "reports", "assets", "scoped-autonomy-npm-dependency-runs.jsonl"));
const browserActionSemanticCorpus = readBrowserActionSemanticLiveCorpus(join("docs", "dogfood", "browser-action-semantic-live-corpus.jsonl"));
const browserActionRecoveryCorpus = readBrowserActionSemanticLiveCorpus(join("docs", "dogfood", "browser-action-recovery-live-corpus.jsonl"));
const deferredReleaseGates = readJsonIfExists(join("docs", "release", "deferred-gates.json"));
const releaseReadinessReport = readJsonIfExists(join("dist", "reports", "release-readiness-latest.json"));
const packageManifest = readJsonIfExists("package.json");

const latestProcess = processRuns.at(-1) ?? null;
const previousProcess = processRuns.length > 1 ? processRuns.at(-2) : null;
const gates = [
  evaluateProcessValidationGate(latestProcess, previousProcess),
  evaluateLiveWebResearchGate("scoped_autonomy_live_web_research", scopedLiveRuns, scopedLiveSamples),
  evaluateLiveWebResearchGate("computer_session_live_web_research", computerLiveRuns, computerLiveSamples),
  evaluateComputerSessionBrowserPromptDogfoodGate(computerBrowserPromptRuns),
  evaluateComputerSessionBrowserPromptLiveGate(computerBrowserPromptLiveRuns, computerBrowserPromptLiveSamples),
  evaluateLiveTaskBenchmarkHarnessGate(computerUseLiveTaskBenchmarkRuns),
  evaluateBrowserActionSemanticCorpusGate(browserActionSemanticCorpus),
  evaluateBrowserActionRecoveryCorpusGate(browserActionRecoveryCorpus),
  evaluateScopedAutonomySelfImplementationBreadthGate(scopedAutonomySelfImplementationRuns, scopedAutonomySelfImplementationSamples),
  evaluateScopedAutonomyGeneratedToolLiveBreadthGate(scopedAutonomyGeneratedToolLiveBreadthRuns, scopedAutonomyGeneratedToolLiveBreadthSamples),
  evaluateScopedAutonomyNpmDependencyDogfoodGate(scopedAutonomyNpmDependencyRuns, scopedAutonomyNpmDependencySamples),
  evaluateBrowserBridgeRestrictedReloadBoundaryGate(latestProcess, packageManifest),
  evaluateBrowserChromeDeepActionEvidenceUxGate(packageManifest),
  evaluateBrowserChromeRepeatedDogfoodGate(computerBrowserChromeDogfoodRuns, computerBrowserChromeDogfoodSamples),
  evaluateBrowserChromeLiveExtensionDogfoodGate(computerBrowserChromeLiveExtensionRuns, computerBrowserChromeLiveExtensionSamples),
  evaluateBrowserChromePublicExtensionDogfoodGate(computerBrowserChromePublicExtensionRuns, computerBrowserChromePublicExtensionSamples),
  evaluateRendererPermissionProfileUxGate(packageManifest),
  evaluateWindowsNativeWatchBoundaryGate(latestProcess, deferredReleaseGates, packageManifest, releaseReadinessReport),
  evaluateWindowsSettingsReversibleDogfoodBoundaryGate(packageManifest),
  evaluateFutureVmSandboxBoundaryGate(packageManifest)
];
const output = {
  schemaVersion: "computer-use-promotion-gate.v1",
  generatedAt: new Date().toISOString(),
  date: evidenceDate,
  criteria: {
    minimumRepeatedLiveRuns: 2,
    requireP95LatencyForLivePromotion: true,
    requireSourceQualityReview: true,
    requireBrowserFallbackCalibration: true,
    requireNoUnexpectedFailures: true,
    requireNoTaskSuccessRegression: true,
    requireNoP95Regression: true,
    requireNoUnsafeRejectionRegression: true
  },
  inputs: {
    processValidationEvidence: processRuns.map((run) => run.path),
    scopedAutonomyLiveEvidence: scopedLiveRuns.map((run) => run.path),
    scopedAutonomyLiveSampleLedger: scopedLiveSamples.path,
    scopedAutonomyLiveSampleCount: scopedLiveSamples.samples.length,
    computerSessionLiveEvidence: computerLiveRuns.map((run) => run.path),
    computerSessionLiveSampleLedger: computerLiveSamples.path,
    computerSessionLiveSampleCount: computerLiveSamples.samples.length,
    computerSessionBrowserPromptEvidence: computerBrowserPromptRuns.map((run) => run.path),
    computerSessionBrowserPromptLiveEvidence: computerBrowserPromptLiveRuns.map((run) => run.path),
    computerSessionBrowserPromptLiveSampleLedger: computerBrowserPromptLiveSamples.path,
    computerSessionBrowserPromptLiveSampleCount: computerBrowserPromptLiveSamples.samples.length,
    computerSessionBrowserChromeDogfoodEvidence: computerBrowserChromeDogfoodRuns.map((run) => run.path),
    computerSessionBrowserChromeDogfoodSampleLedger: computerBrowserChromeDogfoodSamples.path,
    computerSessionBrowserChromeDogfoodSampleCount: computerBrowserChromeDogfoodSamples.samples.length,
    computerSessionBrowserChromeLiveExtensionEvidence: computerBrowserChromeLiveExtensionRuns.map((run) => run.path),
    computerSessionBrowserChromeLiveExtensionSampleLedger: computerBrowserChromeLiveExtensionSamples.path,
    computerSessionBrowserChromeLiveExtensionSampleCount: computerBrowserChromeLiveExtensionSamples.samples.length,
    computerSessionBrowserChromePublicExtensionEvidence: computerBrowserChromePublicExtensionRuns.map((run) => run.path),
    computerUseLiveTaskBenchmarkEvidence: computerUseLiveTaskBenchmarkRuns.map((run) => run.path),
    computerSessionBrowserChromePublicExtensionSampleLedger: computerBrowserChromePublicExtensionSamples.path,
    computerSessionBrowserChromePublicExtensionSampleCount: computerBrowserChromePublicExtensionSamples.samples.length,
    scopedAutonomySelfImplementationEvidence: scopedAutonomySelfImplementationRuns.map((run) => run.path),
    scopedAutonomySelfImplementationSampleLedger: scopedAutonomySelfImplementationSamples.path,
    scopedAutonomySelfImplementationSampleCount: scopedAutonomySelfImplementationSamples.samples.length,
    scopedAutonomyGeneratedToolLiveBreadthEvidence: scopedAutonomyGeneratedToolLiveBreadthRuns.map((run) => run.path),
    scopedAutonomyGeneratedToolLiveBreadthSampleLedger: scopedAutonomyGeneratedToolLiveBreadthSamples.path,
    scopedAutonomyGeneratedToolLiveBreadthSampleCount: scopedAutonomyGeneratedToolLiveBreadthSamples.samples.length,
    scopedAutonomyNpmDependencyEvidence: scopedAutonomyNpmDependencyRuns.map((run) => run.path),
    scopedAutonomyNpmDependencySampleLedger: scopedAutonomyNpmDependencySamples.path,
    scopedAutonomyNpmDependencySampleCount: scopedAutonomyNpmDependencySamples.samples.length,
    browserActionSemanticCorpus: browserActionSemanticCorpus.path,
    browserActionSemanticCorpusCount: browserActionSemanticCorpus.entries.length,
    browserActionRecoveryCorpus: browserActionRecoveryCorpus.path,
    browserActionRecoveryCorpusCount: browserActionRecoveryCorpus.entries.length,
    deferredReleaseGates: "docs/release/deferred-gates.json",
    packageManifest: "package.json"
  },
  gates,
  summary: summarizeGates(gates)
};

if (!dryRun) {
  await mkdir(assetDir, { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  await writeFile(reportPath, renderReport(output), "utf8");
}

if (printJson) {
  console.log(JSON.stringify(output, null, 2));
} else {
  console.log(`computer-use promotion gate: ${output.summary.overallStatus}`);
  for (const gate of gates) {
    console.log(`${gate.status} ${gate.id}: ${gate.reasons.join("; ")}`);
  }
  if (!dryRun) {
    console.log(`evidence: ${evidencePath}`);
    console.log(`report: ${reportPath}`);
  }
}
