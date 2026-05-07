import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, it } from 'node:test';
import { SidecarArtifactSchema } from '../src/lib/schemas/index.js';

const execFileAsync = promisify(execFile);
const wrapperPath = path.join(process.cwd(), '.vibe', 'harness', 'scripts', 'vibe-sidecar-run.mjs');

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function packetHash(packetWithoutHash: Record<string, unknown>): string {
  return `sha256:${createHash('sha256').update(stableStringify(packetWithoutHash)).digest('hex')}`;
}

async function makeProjectRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'vibe-sidecar-'));
  await mkdir(path.join(root, '.vibe', 'agent'), { recursive: true });
  await writeFile(path.join(root, '.vibe', 'agent', 'handoff.md'), '# handoff\n', 'utf8');
  await writeFile(
    path.join(root, '.vibe', 'agent', 'session-log.md'),
    '# session\n\n## Entries\n- seed\n',
    'utf8',
  );
  await writeJson(path.join(root, '.vibe', 'agent', 'sprint-status.json'), {
    schemaVersion: '0.1',
    project: { name: 'fixture' },
  });
  return root;
}

async function readDurableState(root: string): Promise<string[]> {
  return Promise.all([
    readFile(path.join(root, '.vibe', 'agent', 'handoff.md'), 'utf8'),
    readFile(path.join(root, '.vibe', 'agent', 'session-log.md'), 'utf8'),
    readFile(path.join(root, '.vibe', 'agent', 'sprint-status.json'), 'utf8'),
  ]);
}

async function runWrapper(root: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(process.execPath, [wrapperPath, 'diff-reviewer', '--sprint-id', 'sprint-sidecar', '--cwd', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
}

describe('vibe-sidecar-run', () => {
  it('writes a validated advisory artifact without touching durable state', async () => {
    const root = await makeProjectRoot();
    try {
      const before = await readDurableState(root);
      const mockOutput = path.join(root, 'mock-output.json');
      await writeJson(mockOutput, {
        schemaVersion: 1,
        sidecar: 'diff-reviewer',
        status: 'advisory',
        summary: 'One regression risk found.',
        findings: [
          {
            severity: 'medium',
            confidence: 'high',
            file: 'src/example.ts',
            line: 12,
            message: 'Changed branch no longer handles empty input.',
            recommendation: 'Restore the empty-input guard or add a regression test.',
          },
        ],
        limitations: ['Static diff review only.'],
        coverage: {
          inputFilesSeen: 1,
          diffBytesSeen: 120,
          truncated: false,
        },
      });

      const result = await runWrapper(root, ['--mock-output-file', mockOutput]);
      const artifactPath = result.stdout.trim();
      assert.equal(
        artifactPath.replaceAll('\\', '/').endsWith('.vibe/sidecars/artifacts/sprint-sidecar/diff-reviewer.json'),
        true,
      );

      const artifact = SidecarArtifactSchema.parse(JSON.parse(await readFile(artifactPath, 'utf8')));
      assert.equal(artifact.status, 'advisory');
      assert.equal(artifact.provider, 'mock');
      assert.equal(artifact.findings.length, 1);
      assert.deepEqual(artifact.coverage, { inputFilesSeen: 0, diffBytesSeen: 0, truncated: false });
      assert.match(artifact.inputHash, /^sha256:[a-f0-9]{64}$/);
      assert.deepEqual(await readDurableState(root), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('records malformed sidecar output as error instead of pass', async () => {
    const root = await makeProjectRoot();
    try {
      const mockOutput = path.join(root, 'bad-output.txt');
      await writeFile(mockOutput, 'not json', 'utf8');

      await runWrapper(root, ['--mock-output-file', mockOutput]);
      const artifactPath = path.join(root, '.vibe', 'sidecars', 'artifacts', 'sprint-sidecar', 'diff-reviewer.json');
      const artifact = SidecarArtifactSchema.parse(JSON.parse(await readFile(artifactPath, 'utf8')));
      assert.equal(artifact.status, 'error');
      assert.match(artifact.summary, /did not match/);
      assert.equal(artifact.findings.length, 0);
      assert.equal(artifact.rawPreview, 'not json');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects reviewer outputs that violate status and findings semantics', async () => {
    const root = await makeProjectRoot();
    try {
      const mockOutput = path.join(root, 'contradictory-output.json');
      await writeJson(mockOutput, {
        schemaVersion: 1,
        sidecar: 'diff-reviewer',
        status: 'pass',
        summary: 'No issues.',
        findings: [
          {
            severity: 'low',
            confidence: 'high',
            file: 'src/example.ts',
            line: 1,
            message: 'This finding contradicts pass status.',
            recommendation: 'Return advisory or remove findings.',
          },
        ],
        limitations: ['Static diff review only.'],
        coverage: { inputFilesSeen: 1, diffBytesSeen: 10, truncated: false },
      });

      await runWrapper(root, ['--mock-output-file', mockOutput]);
      const artifactPath = path.join(root, '.vibe', 'sidecars', 'artifacts', 'sprint-sidecar', 'diff-reviewer.json');
      const artifact = SidecarArtifactSchema.parse(JSON.parse(await readFile(artifactPath, 'utf8')));
      assert.equal(artifact.status, 'error');
      assert.match(artifact.error ?? '', /status pass requires zero findings/);
      assert.equal(artifact.findings.length, 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps wrapper-owned packet coverage when reviewer output disagrees', async () => {
    const root = await makeProjectRoot();
    try {
      const mockOutput = path.join(root, 'coverage-output.json');
      await writeJson(mockOutput, {
        schemaVersion: 1,
        sidecar: 'diff-reviewer',
        status: 'pass',
        summary: 'No issues.',
        findings: [],
        limitations: ['Static diff review only.'],
        coverage: { inputFilesSeen: 99, diffBytesSeen: 999, truncated: true },
      });

      await runWrapper(root, ['--mock-output-file', mockOutput]);
      const artifactPath = path.join(root, '.vibe', 'sidecars', 'artifacts', 'sprint-sidecar', 'diff-reviewer.json');
      const artifact = SidecarArtifactSchema.parse(JSON.parse(await readFile(artifactPath, 'utf8')));
      assert.equal(artifact.status, 'pass');
      assert.deepEqual(artifact.coverage, { inputFilesSeen: 0, diffBytesSeen: 0, truncated: false });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('resolves mock sidecar input paths relative to --cwd', async () => {
    const root = await makeProjectRoot();
    try {
      await writeJson(path.join(root, 'relative-output.json'), {
        schemaVersion: 1,
        sidecar: 'diff-reviewer',
        status: 'pass',
        summary: 'No issues.',
        findings: [],
        limitations: ['Static diff review only.'],
        coverage: { inputFilesSeen: 0, diffBytesSeen: 0, truncated: false },
      });

      await runWrapper(root, ['--mock-output-file', 'relative-output.json']);
      const artifactPath = path.join(root, '.vibe', 'sidecars', 'artifacts', 'sprint-sidecar', 'diff-reviewer.json');
      const artifact = SidecarArtifactSchema.parse(JSON.parse(await readFile(artifactPath, 'utf8')));
      assert.equal(artifact.status, 'pass');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('resolves input packet paths relative to --cwd and verifies their hash', async () => {
    const root = await makeProjectRoot();
    try {
      await writeJson(path.join(root, 'relative-output.json'), {
        schemaVersion: 1,
        sidecar: 'diff-reviewer',
        status: 'pass',
        summary: 'No issues.',
        findings: [],
        limitations: ['Static diff review only.'],
        coverage: { inputFilesSeen: 0, diffBytesSeen: 0, truncated: false },
      });
      const packetWithoutHash = {
        schemaVersion: 1,
        sidecar: 'diff-reviewer',
        sprintId: 'sprint-sidecar',
        gitSha: 'fixture',
        diff: '',
        changedFiles: [],
        checklist: [],
        relevantLogs: [],
        evidenceRefs: [],
        coverage: { inputFilesSeen: 0, diffBytesSeen: 0, truncated: false },
      };
      await writeJson(path.join(root, 'packet.json'), {
        ...packetWithoutHash,
        inputHash: packetHash(packetWithoutHash),
      });

      await runWrapper(root, ['--input-file', 'packet.json', '--mock-output-file', 'relative-output.json']);
      const artifactPath = path.join(root, '.vibe', 'sidecars', 'artifacts', 'sprint-sidecar', 'diff-reviewer.json');
      const artifact = SidecarArtifactSchema.parse(JSON.parse(await readFile(artifactPath, 'utf8')));
      assert.equal(artifact.status, 'pass');
      assert.equal(artifact.inputHash, packetHash(packetWithoutHash));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects input packets whose inputHash no longer matches packet content', async () => {
    const root = await makeProjectRoot();
    try {
      const packetPath = path.join(root, 'packet.json');
      await writeJson(packetPath, {
        schemaVersion: 1,
        sidecar: 'diff-reviewer',
        sprintId: 'sprint-sidecar',
        gitSha: 'fixture',
        inputHash: `sha256:${'0'.repeat(64)}`,
        diff: '',
        changedFiles: [],
        checklist: [],
        relevantLogs: [],
        evidenceRefs: [],
        coverage: { inputFilesSeen: 0, diffBytesSeen: 0, truncated: false },
      });

      await assert.rejects(runWrapper(root, ['--input-file', packetPath, '--mock-output-file', 'missing']));
      assert.equal(existsSync(path.join(root, '.vibe', 'sidecars')), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('marks omitted sensitive and untracked diff content as truncated wrapper coverage', async () => {
    const root = await makeProjectRoot();
    try {
      await execFileAsync('git', ['init'], { cwd: root });
      await execFileAsync('git', ['config', 'user.email', 'sidecar@example.com'], { cwd: root });
      await execFileAsync('git', ['config', 'user.name', 'Sidecar Test'], { cwd: root });
      await mkdir(path.join(root, 'src'), { recursive: true });
      await writeFile(path.join(root, 'src', 'example.ts'), 'export const value = 1;\n', 'utf8');
      await execFileAsync('git', ['add', 'src/example.ts'], { cwd: root });
      await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: root });
      await writeFile(path.join(root, 'src', 'example.ts'), 'export const value = 2;\n', 'utf8');
      await writeFile(path.join(root, '.env.local'), 'TOKEN=secret\n', 'utf8');
      await writeFile(path.join(root, 'notes.txt'), 'untracked local note\n', 'utf8');

      const mockOutput = path.join(root, 'mock-output.json');
      await writeJson(mockOutput, {
        schemaVersion: 1,
        sidecar: 'diff-reviewer',
        status: 'pass',
        summary: 'No issues.',
        findings: [],
        limitations: ['Static diff review only.'],
        coverage: { inputFilesSeen: 0, diffBytesSeen: 0, truncated: false },
      });

      await runWrapper(root, ['--mock-output-file', mockOutput]);
      const artifactPath = path.join(root, '.vibe', 'sidecars', 'artifacts', 'sprint-sidecar', 'diff-reviewer.json');
      const artifact = SidecarArtifactSchema.parse(JSON.parse(await readFile(artifactPath, 'utf8')));
      assert.equal(artifact.status, 'pass');
      assert.equal(artifact.coverage.inputFilesSeen >= 3, true);
      assert.equal(artifact.coverage.truncated, true);
      assert.equal(artifact.coverage.diffBytesSeen > 0, true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('omits non-text untracked content even when untracked content is explicitly included', async () => {
    const root = await makeProjectRoot();
    try {
      await execFileAsync('git', ['init'], { cwd: root });
      await writeFile(path.join(root, 'asset.dat'), Buffer.from([0xff, 0xfe, 0xfd]));

      const mockOutput = path.join(root, 'mock-output.json');
      await writeJson(mockOutput, {
        schemaVersion: 1,
        sidecar: 'diff-reviewer',
        status: 'pass',
        summary: 'No issues.',
        findings: [],
        limitations: ['Static diff review only.'],
        coverage: { inputFilesSeen: 0, diffBytesSeen: 0, truncated: false },
      });

      await runWrapper(root, ['--mock-output-file', mockOutput, '--include-untracked-content']);
      const artifactPath = path.join(root, '.vibe', 'sidecars', 'artifacts', 'sprint-sidecar', 'diff-reviewer.json');
      const artifact = SidecarArtifactSchema.parse(JSON.parse(await readFile(artifactPath, 'utf8')));
      assert.equal(artifact.status, 'pass');
      assert.equal(artifact.coverage.truncated, true);
      assert.equal(artifact.coverage.diffBytesSeen > 0, true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('records timeout as unavailable', async () => {
    const root = await makeProjectRoot();
    try {
      const mockOutput = path.join(root, 'slow-output.json');
      await writeJson(mockOutput, {
        schemaVersion: 1,
        sidecar: 'diff-reviewer',
        status: 'pass',
        summary: 'No issues.',
        findings: [],
        limitations: [],
        coverage: { inputFilesSeen: 0, diffBytesSeen: 0, truncated: false },
      });

      await runWrapper(root, ['--mock-output-file', mockOutput, '--mock-delay-ms', '50', '--timeout-ms', '10']);
      const artifactPath = path.join(root, '.vibe', 'sidecars', 'artifacts', 'sprint-sidecar', 'diff-reviewer.json');
      const artifact = SidecarArtifactSchema.parse(JSON.parse(await readFile(artifactPath, 'utf8')));
      assert.equal(artifact.status, 'unavailable');
      assert.equal(artifact.error, 'timeout');
      assert.equal(artifact.findings.length, 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects path traversal sprint ids before artifact creation', async () => {
    const root = await makeProjectRoot();
    try {
      await assert.rejects(
        execFileAsync(
          process.execPath,
          [wrapperPath, 'diff-reviewer', '--sprint-id', '../bad', '--cwd', root, '--mock-output-file', 'missing'],
          { encoding: 'utf8' },
        ),
      );
      assert.equal(existsSync(path.join(root, '.vibe', 'sidecars')), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects artifact roots outside --cwd', async () => {
    const root = await makeProjectRoot();
    try {
      const outsideRoot = path.join(path.dirname(root), 'sidecar-outside');
      await assert.rejects(
        execFileAsync(
          process.execPath,
          [
            wrapperPath,
            'diff-reviewer',
            '--sprint-id',
            'sprint-sidecar',
            '--cwd',
            root,
            '--artifact-root',
            outsideRoot,
            '--mock-output-file',
            'missing',
          ],
          { encoding: 'utf8' },
        ),
      );
      assert.equal(existsSync(outsideRoot), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('ships sidecar runtime artifacts as ignored non-durable files', async () => {
    const gitignore = await readFile('.gitignore', 'utf8');
    assert.match(gitignore, /^\.vibe\/sidecars\/$/m);

    const manifest = JSON.parse(await readFile('.vibe/sync-manifest.json', 'utf8')) as {
      files: { harness: string[] };
    };
    assert.equal(manifest.files.harness.includes('.vibe/harness/sidecars/**'), true);
    assert.equal(manifest.files.harness.includes('.vibe/harness/schemas/**'), true);
    assert.equal(manifest.files.harness.includes('.codex/agents/**'), true);
    assert.equal(manifest.files.harness.includes('.claude/agents/**'), true);
  });
});
