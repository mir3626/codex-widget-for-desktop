#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const options = parseArgs(process.argv.slice(2));
const outDir = path.resolve(options.outDir || ".runtime/asr/human-mic-corpus");
const manifestPath = path.join(outDir, "manifest.json");
const readmePath = path.join(outDir, "README.md");

mkdirSync(outDir, { recursive: true });

if (existsSync(manifestPath) && !options.force) {
  console.log(`human ASR corpus scaffold already exists: ${manifestPath}`);
  console.log("Use --force to regenerate the template after backing up local recordings.");
  process.exit(0);
}

const samples = [
  {
    id: "browser-search-human-01",
    path: "browser-search-human-01.wav",
    text: "검색창에 브라우저 액션 테스트 입력하고 검색해줘",
    scenario: "browser-action-search"
  },
  {
    id: "browser-history-human-01",
    path: "browser-history-human-01.wav",
    text: "뒤로가기 한 번 해줘",
    scenario: "browser-history"
  },
  {
    id: "windows-settings-human-01",
    path: "windows-settings-human-01.wav",
    text: "윈도우 디스플레이 설정 열어줘",
    scenario: "windows-settings"
  },
  {
    id: "safe-side-effect-human-01",
    path: "safe-side-effect-human-01.wav",
    text: "지금 화면에서 삭제 버튼은 누르지 말고 어디 있는지만 알려줘",
    scenario: "safe-side-effect-avoidance"
  },
  {
    id: "mixed-package-human-01",
    path: "mixed-package-human-01.wav",
    text: "리액트 라우터 돔 설치 명령어 찾아줘",
    scenario: "mixed-korean-english-package"
  },
  {
    id: "deictic-target-human-01",
    path: "deictic-target-human-01.wav",
    text: "방금 뜬 오류 메시지 아래에 있는 확인 버튼 눌러줘",
    scenario: "deictic-target"
  }
];

const manifest = {
  schemaVersion: "codex-widget-asr-human-corpus.v1",
  createdAt: new Date().toISOString(),
  language: "ko",
  notes: [
    "Record each WAV as mono or stereo PCM if possible.",
    "Keep recordings local under .runtime; do not commit raw microphone audio.",
    "Benchmark with --persistent first so model load does not dominate every utterance."
  ],
  samples: samples.map((sample) => ({
    ...sample,
    language: "ko",
    durationMs: 3000
  }))
};

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
writeFileSync(readmePath, buildReadme(samples), "utf8");

console.log(`human ASR corpus scaffold written: ${outDir}`);
console.log(`manifest: ${manifestPath}`);
console.log("Record WAV files at the listed paths, then run:");
console.log(`node scripts/benchmark-asr-candidates.mjs --persistent --candidate faster-whisper-large-v3-turbo-cpu --manifest "${manifestPath}" --json`);

function buildReadme(rows) {
  return `# Human Microphone ASR Corpus

This directory is ignored by git through \`.runtime/\`. Keep raw microphone audio
local and commit only redacted aggregate reports.

## Recording List

${rows.map((row, index) => `${index + 1}. \`${row.path}\` - ${row.text}`).join("\n")}

## Benchmark

\`\`\`powershell
$env:CODEX_WIDGET_ASR_PYTHON = "$PWD\\.runtime\\asr\\faster-whisper\\Scripts\\python.exe"
$env:CODEX_WIDGET_ASR_FASTER_WHISPER_DOWNLOAD_ROOT = "$PWD\\.runtime\\asr\\models\\faster-whisper"
node scripts/benchmark-asr-candidates.mjs --persistent --candidate faster-whisper-large-v3-turbo-cpu --manifest "$PWD\\.runtime\\asr\\human-mic-corpus\\manifest.json" --json
\`\`\`
`;
}

function parseArgs(args) {
  const parsed = {
    outDir: "",
    force: false
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--out") {
      parsed.outDir = args[++index] ?? "";
    } else if (arg === "--force") {
      parsed.force = true;
    }
  }
  return parsed;
}
