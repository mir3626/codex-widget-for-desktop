#!/usr/bin/env node
import { listAsrCandidates, resolveAsrCandidate } from "./asr-runtime-candidates.mjs";

const args = new Set(process.argv.slice(2));
const json = args.has("--json");
const cpuOnly = args.has("--cpu-only");
const candidates = listAsrCandidates({ includeGpu: !cpuOnly }).map((candidate) => resolveAsrCandidate(candidate.id));

if (json) {
  console.log(JSON.stringify(candidates, null, 2));
} else {
  for (const candidate of candidates) {
    console.log(`${candidate.id}`);
    console.log(`  family: ${candidate.family}`);
    console.log(`  model: ${candidate.model}`);
    console.log(`  device: ${candidate.device}`);
    console.log(`  compute: ${candidate.computeType}`);
    console.log(`  command: ${candidate.command}`);
    console.log(`  purpose: ${candidate.purpose}`);
    console.log(`  tradeoff: ${candidate.tradeoff}`);
  }
}
