import assert from 'node:assert/strict';
import { execFile as execFileCallback, execFileSync, spawnSync } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, it } from 'node:test';
import { resolveGitBashPath } from '../src/lib/shell.js';

const execFile = promisify(execFileCallback);
const tempDirs: string[] = [];
const bashScriptPath = path.resolve('.vibe', 'harness', 'scripts', 'run-codex.sh');
const cmdScriptPath = path.resolve('.vibe', 'harness', 'scripts', 'run-codex.cmd');
const rulesPath = path.resolve('.vibe', 'agent', '_common-rules.md');
const shellPath = process.env.COMSPEC ?? 'cmd.exe';

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

function detectWorkingBash(): string | null {
  try {
    if (process.platform === 'win32') {
      const gitBash = resolveGitBashPath();
      if (!gitBash) {
        return null;
      }
      execFileSync(gitBash, ['--version'], { stdio: 'ignore' });
      const uname = execFileSync(gitBash, ['-lc', 'uname -s'], { encoding: 'utf8' }).trim();
      if (!/^(MINGW|MSYS|CYGWIN)/.test(uname)) {
        return null;
      }
      return gitBash;
    }

    execFileSync('bash', ['--version'], { stdio: 'ignore' });
    return execFileSync('which', ['bash'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

const bashCommand = detectWorkingBash();

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeExecutable(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
  if (!filePath.endsWith('.cmd')) {
    await chmod(filePath, 0o755);
  }
}

async function writeUnameStub(binDir: string, output: string): Promise<void> {
  const escapedOutput = output.replace(/"/g, '\\"');
  await writeExecutable(path.join(binDir, 'uname'), `#!/usr/bin/env bash\necho "${escapedOutput}"\n`);
}

type ShellStubMode =
  | 'ok'
  | 'auth'
  | 'timeout'
  | 'stdin'
  | 'fail'
  | 'fail-403'
  | 'tokens'
  | 'tokens-used'
  | 'tokens-crlf'
  | 'tokens-malformed';

async function createShellStubBin(mode: ShellStubMode): Promise<string> {
  const binDir = await makeTempDir('run-codex-shell-bin-');
  const codexScript = `#!/usr/bin/env bash
if [[ "\${1:-}" == "--version" ]]; then
  case "${mode}" in
    ok)
      echo "codex 0.9.1"
      exit 0
      ;;
    auth)
      echo "not authenticated" >&2
      exit 1
      ;;
    timeout)
      sleep 30
      exit 0
      ;;
    *)
      echo "codex 0.9.1"
      exit 0
      ;;
  esac
fi

if [[ "\${1:-}" == "exec" ]]; then
  case "${mode}" in
    stdin|ok)
      cat
      exit 0
      ;;
    tokens)
      echo "tokens: 1234"
      exit 0
      ;;
    tokens-used)
      echo "tokens used 12345"
      exit 0
      ;;
    tokens-crlf)
      printf 'tokens used 99\\r\\n'
      exit 0
      ;;
    tokens-malformed)
      echo "tokens used"
      exit 0
      ;;
    fail)
      echo "plain failure" >&2
      exit 1
      ;;
    fail-403)
      echo "403 Forbidden" >&2
      exit 1
      ;;
    *)
      cat
      exit 0
      ;;
  esac
fi

exit 0
`;
  const timeoutScript = `#!/usr/bin/env bash
if [[ "\${TIMEOUT_STUB_MODE:-pass}" == "timeout" ]]; then
  exit 124
fi
shift
"\$@"
`;
  const chcpScript = `#!/usr/bin/env bash
cat >/dev/null
exit 0
`;
  const localeScript = `#!/usr/bin/env bash
if [[ "\${1:-}" == "-a" ]]; then
  printf 'C\\nC.UTF-8\\nPOSIX\\n'
  exit 0
fi
printf 'LANG=C.UTF-8\\n'
`;
  const sleepScript = '#!/usr/bin/env bash\nexit 0\n';

  await writeExecutable(path.join(binDir, 'codex'), codexScript);
  await writeExecutable(path.join(binDir, 'timeout'), timeoutScript);
  await writeExecutable(path.join(binDir, 'chcp.com'), chcpScript);
  await writeExecutable(path.join(binDir, 'locale'), localeScript);
  await writeExecutable(path.join(binDir, 'sleep'), sleepScript);
  return binDir;
}

async function readTokensJson(root: string): Promise<{
  cumulativeTokens: number;
  elapsedSeconds: number;
  sprintTokens: Record<string, number>;
}> {
  const raw = await readFile(path.join(root, '.vibe', 'agent', 'tokens.json'), 'utf8');
  const parsed = JSON.parse(raw) as {
    cumulativeTokens?: unknown;
    elapsedSeconds?: unknown;
    sprintTokens?: unknown;
  };
  assert.equal(typeof parsed.cumulativeTokens, 'number');
  assert.equal(typeof parsed.elapsedSeconds, 'number');
  assert.equal(typeof parsed.sprintTokens, 'object');
  assert.notEqual(parsed.sprintTokens, null);
  assert.equal(Array.isArray(parsed.sprintTokens), false);
  return parsed as { cumulativeTokens: number; elapsedSeconds: number; sprintTokens: Record<string, number> };
}

async function createCmdStubBin(mode: 'ok' | 'stdin'): Promise<string> {
  const binDir = await makeTempDir('run-codex-cmd-bin-');
  const codexCmd = `@echo off
setlocal EnableExtensions
if "%~1"=="--version" (
  echo codex 0.9.1
  endlocal & exit /b 0
)
if "%~1"=="exec" (
  ${mode === 'stdin' ? 'more' : 'echo exec ok'}
  endlocal & exit /b 0
)
endlocal & exit /b 0
`;
  await writeExecutable(path.join(binDir, 'codex.cmd'), codexCmd);
  return binDir;
}

function shellEnv(binDir: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const inheritedEntries = Object.entries(process.env).filter(([key]) => {
    const normalizedKey = key.toLowerCase();
    return normalizedKey !== 'path' && !['lang', 'lc_all', 'language'].includes(normalizedKey);
  });
  const extraEntries = Object.entries(extra).filter(([key]) => key.toLowerCase() !== 'path');
  const inheritedEnv = Object.fromEntries(inheritedEntries);
  const extraEnv = Object.fromEntries(extraEntries);
  const explicitPathEntry = Object.entries(extra).find(([key]) => key.toLowerCase() === 'path');
  const basePath =
    explicitPathEntry
      ? (explicitPathEntry[1] ?? '')
      : (process.env.PATH ?? process.env.Path ?? '');

  return {
    ...inheritedEnv,
    LANG: 'C',
    LC_ALL: '',
    LANGUAGE: '',
    ...extraEnv,
    VIBE_SKIP_AGENT_SESSION_START: extra.VIBE_SKIP_AGENT_SESSION_START ?? '1',
    VIBE_DISABLE_ATTENTION: extra.VIBE_DISABLE_ATTENTION ?? '1',
    PATH: basePath ? `${binDir}${path.delimiter}${basePath}` : binDir,
  };
}

async function runShellStatusTickFixture(mode: ShellStubMode) {
  const binDir = await createShellStubBin(mode);
  const cwd = await makeTempDir(`run-codex-status-${mode}-`);
  const child = spawnSync(bashCommand ?? 'bash', [bashScriptPath, 'prompt text'], {
    cwd,
    env: shellEnv(binDir, { CODEX_RETRY: '1', VIBE_SPRINT_ID: 'sprint-example' }),
    input: '',
    encoding: 'utf8',
  });
  return { child, cwd };
}

describe('run-codex.sh wrapper', { skip: bashCommand === null }, () => {
  it('returns normalized version output for healthy codex', async () => {
    const binDir = await createShellStubBin('ok');
    const { stdout } = await execFile(bashCommand ?? 'bash', [bashScriptPath, '--health'], {
      env: shellEnv(binDir),
    });

    assert.equal(stdout.trim(), 'codex-cli 0.9.1');
  });

  it('returns rc=1 when codex is missing', async () => {
    const binDir = await makeTempDir('run-codex-empty-bin-');
    const bashExecutable =
      bashCommand ??
      execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['bash'], {
        encoding: 'utf8',
      })
        .split(/\r?\n/)
        .find((entry) => entry.length > 0) ?? (bashCommand ?? 'bash');
    const minimalEnv = {
      PATH: binDir,
      HOME: process.env.HOME ?? process.env.USERPROFILE ?? '',
      USERPROFILE: process.env.USERPROFILE ?? '',
      SYSTEMROOT: process.env.SYSTEMROOT ?? '',
      TEMP: process.env.TEMP ?? '',
      TMP: process.env.TMP ?? '',
      TMPDIR: process.env.TMPDIR ?? '',
    };
    const child = spawnSync(bashExecutable, [bashScriptPath, '--health'], {
      env: minimalEnv,
      encoding: 'utf8',
    });

    assert.equal(child.status, 1);
    assert.match(child.stderr, /not found/i);
  });

  it('rejects Windows npm shim paths when running under WSL', async () => {
    const binDir = await makeTempDir('run-codex-wsl-shim-');
    const child = spawnSync(bashCommand ?? 'bash', [bashScriptPath, '--health'], {
      env: shellEnv(binDir, {
        CODEX_BIN: '/mnt/c/Users/Tony/AppData/Roaming/npm/codex',
        OS: '',
        WSL_DISTRO_NAME: 'Ubuntu',
      }),
      encoding: 'utf8',
    });

    assert.equal(child.status, 1);
    assert.match(child.stderr, /Windows npm shim/);
  });

  it('returns rc=2 when auth is missing', async () => {
    const binDir = await createShellStubBin('auth');

    await assert.rejects(
      execFile(bashCommand ?? 'bash', [bashScriptPath, '--health'], {
        env: shellEnv(binDir),
      }),
      (error: unknown) => {
        assert.equal(typeof error, 'object');
        assert.equal((error as { code?: number }).code, 2);
        assert.match((error as { stderr?: string }).stderr ?? '', /authentication missing|not authenticated/i);
        return true;
      },
    );
  });

  it('returns rc=2 on timeout-like health failures', async () => {
    const binDir = await createShellStubBin('timeout');

    await assert.rejects(
      execFile(bashCommand ?? 'bash', [bashScriptPath, '--health'], {
        env: shellEnv(binDir, { TIMEOUT_STUB_MODE: 'timeout' }),
      }),
      (error: unknown) => {
        assert.equal(typeof error, 'object');
        assert.equal((error as { code?: number }).code, 2);
        assert.match((error as { stderr?: string }).stderr ?? '', /hung|auth or config issue/i);
        return true;
      },
    );
  });

  it('emits retry logging and gives up after the configured attempts', async () => {
    const binDir = await createShellStubBin('fail');
    const child = spawnSync(bashCommand ?? 'bash', [bashScriptPath, 'prompt text'], {
      env: shellEnv(binDir, { CODEX_RETRY: '3', CODEX_RETRY_DELAY: '0' }),
      input: '',
      encoding: 'utf8',
    });

    assert.equal(child.status, 1);
    assert.match(child.stderr, /attempt 1\/3 starting/);
    assert.match(child.stderr, /attempt 1\/3 retrying reason=exit=1 delay=0s/);
    assert.match(child.stderr, /attempt 2\/3 retrying reason=exit=1 delay=0s/);
    assert.match(child.stderr, /giving up after 3 attempts/);
  });

  it('exhausts retries and emits CODEX_UNAVAILABLE signal + flag file', async () => {
    const binDir = await createShellStubBin('fail-403');
    const cwd = await makeTempDir('run-codex-unavailable-');
    const child = spawnSync(bashCommand ?? 'bash', [bashScriptPath, 'prompt text'], { cwd, env: shellEnv(binDir, { CODEX_RETRY: '3', CODEX_RETRY_DELAY: '0' }), encoding: 'utf8' });

    assert.equal(child.status, 1);
    assert.match(child.stderr, /CODEX_UNAVAILABLE[\s\S]*403-forbidden/);

    const flag = await readFile(path.join(cwd, '.vibe', 'agent', 'codex-unavailable.flag'), 'utf8');
    assert.match(flag, /\d{4}-\d{2}-\d{2}T[\s\S]*last_exit=1[\s\S]*reason_hint=403-forbidden/);
  });

  it('preserves stdin passthrough and common rules injection', async () => {
    const binDir = await createShellStubBin('stdin');
    const rules = await import('node:fs/promises').then(({ readFile }) => readFile(rulesPath, 'utf8'));
    const firstRuleLine = rules.split('\n')[0] ?? '';
    const child = spawnSync(bashCommand ?? 'bash', [bashScriptPath, '-'], {
      env: shellEnv(binDir),
      input: 'hello from stdin',
      encoding: 'utf8',
    });

    assert.equal(child.status, 0);
    assert.match(child.stdout, /hello from stdin/);
    assert.match(child.stdout, new RegExp(firstRuleLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  it('runs provider-neutral session-start before non-health codex execution', async () => {
    const binDir = await createShellStubBin('ok');
    const cwd = await makeTempDir('run-codex-session-start-');
    await mkdir(path.join(cwd, '.vibe'), { recursive: true });
    await writeFile(path.join(cwd, '.vibe', 'config.json'), '{}\n', 'utf8');

    const child = spawnSync(bashCommand ?? 'bash', [bashScriptPath, 'prompt text'], {
      cwd,
      env: shellEnv(binDir, { CODEX_RETRY: '1', VIBE_SKIP_AGENT_SESSION_START: '0' }),
      input: '',
      encoding: 'utf8',
    });

    assert.equal(child.status, 0, child.stderr);

    const dailyDir = path.join(cwd, '.vibe', 'agent', 'daily');
    const [dailyFile] = await readdir(dailyDir);
    assert.match(dailyFile ?? '', /^\d{4}-\d{2}-\d{2}\.jsonl$/);

    const raw = await readFile(path.join(dailyDir, dailyFile ?? ''), 'utf8');
    assert.match(raw, /"type":"session-started"/);
  });

  it('injects §15 scope discipline rule into Generator context', async () => {
    const binDir = await createShellStubBin('stdin');
    const child = spawnSync(bashCommand ?? 'bash', [bashScriptPath, '-'], {
      env: shellEnv(binDir, { VIBE_SPRINT_ID: '' }),
      input: 'hello',
      encoding: 'utf8',
    });

    assert.equal(child.status, 0);
    assert.match(child.stdout, /## §15 Scope discipline/);
    assert.doesNotMatch(child.stdout, /# Referenced MD Context \(auto-injected\)/);
  });

  it('auto-injects referenced rule markdown context into stdin prompts', async () => {
    const binDir = await createShellStubBin('stdin');
    const child = spawnSync(bashCommand ?? 'bash', [bashScriptPath, '-'], {
      env: shellEnv(binDir, { VIBE_SPRINT_ID: '' }),
      input: 'Use docs/context/qa.md while planning verification.',
      encoding: 'utf8',
    });

    assert.equal(child.status, 0);
    assert.match(child.stderr, /injected referenced MD context/);
    assert.match(child.stdout, /# Referenced MD Context \(auto-injected\)/);
    assert.match(child.stdout, /## Source: `docs\/context\/qa\.md`/);
    assert.match(child.stdout, /# QA policy/);
    assert.match(child.stdout, /Use docs\/context\/qa\.md while planning verification\./);
  });

  it('auto-injects transitive markdown references from injected context', async () => {
    const binDir = await createShellStubBin('stdin');
    const cwd = await makeTempDir('run-codex-transitive-md-');
    await mkdir(path.join(cwd, 'docs', 'context'), { recursive: true });
    await writeFile(
      path.join(cwd, 'docs', 'context', 'parent.md'),
      [
        '# Parent',
        '',
        'Read docs/context/ignored.md as ordinary prose.',
        '<!-- BEGIN:TEST:SHARDS -->',
        '- `docs/context/child.md`',
        '<!-- END:TEST:SHARDS -->',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(path.join(cwd, 'docs', 'context', 'child.md'), '# Child\n\nTransitive shard body.\n', 'utf8');
    await writeFile(path.join(cwd, 'docs', 'context', 'ignored.md'), '# Ignored\n\nOrdinary link body.\n', 'utf8');

    const child = spawnSync(bashCommand ?? 'bash', [bashScriptPath, '-'], {
      cwd,
      env: shellEnv(binDir, { VIBE_SPRINT_ID: '' }),
      input: 'Use docs/context/parent.md for this task.',
      encoding: 'utf8',
    });

    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stderr, /injected referenced MD context count=2/);
    assert.match(child.stdout, /## Source: `docs\/context\/parent\.md`/);
    assert.match(child.stdout, /## Source: `docs\/context\/child\.md`/);
    assert.match(child.stdout, /Transitive shard body\./);
    assert.doesNotMatch(child.stdout, /Ordinary link body\./);
  });

  it('auto-injects explicit project context, guide, release index, and sidecar markdown references', async () => {
    const binDir = await createShellStubBin('stdin');
    const child = spawnSync(bashCommand ?? 'bash', [bashScriptPath, '-'], {
      env: shellEnv(binDir, { VIBE_SPRINT_ID: '' }),
      input: 'Use docs/context/product.md, docs/guides/upgrade.md, docs/release/README.md, and .vibe/harness/sidecars/diff-reviewer.md.',
      encoding: 'utf8',
    });

    assert.equal(child.status, 0);
    assert.match(child.stderr, /injected referenced MD context/);
    assert.match(child.stdout, /## Source: `docs\/context\/product\.md`/);
    assert.match(child.stdout, /## Source: `docs\/guides\/upgrade\.md`/);
    assert.match(child.stdout, /## Source: `docs\/release\/README\.md`/);
    assert.match(child.stdout, /## Source: `.vibe\/harness\/sidecars\/diff-reviewer\.md`/);
  });

  it('diagnoses stdin markdown injection without invoking codex', async () => {
    const binDir = await makeTempDir('run-codex-diagnostic-empty-bin-');
    await writeExecutable(path.join(binDir, 'codex'), '#!/usr/bin/env bash\necho "codex invoked" >&2\nexit 66\n');
    const child = spawnSync(bashCommand ?? 'bash', [bashScriptPath, '--diagnose-md-injection', '-'], {
      env: shellEnv(binDir, { VIBE_SPRINT_ID: '', VIBE_SKIP_AGENT_SESSION_START: '0' }),
      input: [
        'Use docs/context/qa.md for verification.',
        'Also inspect docs/context/missing-diagnostic.md, README.md, and .vibe/agent/_common-rules.md.',
      ].join('\n'),
      encoding: 'utf8',
    });

    assert.equal(child.status, 0, child.stderr);
    assert.doesNotMatch(child.stderr, /codex invoked|codex CLI not found/);

    const diagnostic = JSON.parse(child.stdout) as {
      mode?: string;
      scanMode?: string;
      promptSource?: string;
      runtimeInjectionApplies?: boolean;
      commonRules?: { path?: string; exists?: boolean; wouldInject?: boolean };
      referencedMarkdown?: Array<{ path?: string; status?: string; reason?: string }>;
      summary?: { inject?: number; missing?: number; skipped?: number };
    };
    assert.equal(diagnostic.mode, 'md-injection-diagnostic');
    assert.equal(diagnostic.scanMode, 'transitive');
    assert.equal(diagnostic.promptSource, 'stdin');
    assert.equal(diagnostic.runtimeInjectionApplies, true);
    assert.equal(diagnostic.commonRules?.path, '.vibe/agent/_common-rules.md');
    assert.equal(diagnostic.commonRules?.exists, true);
    assert.equal(diagnostic.commonRules?.wouldInject, true);

    const byPath = new Map((diagnostic.referencedMarkdown ?? []).map((entry) => [entry.path, entry]));
    assert.equal(byPath.get('docs/context/qa.md')?.status, 'inject');
    assert.equal(byPath.get('docs/context/missing-diagnostic.md')?.status, 'missing');
    assert.equal(byPath.get('README.md')?.reason, 'not-allowlisted');
    assert.equal(byPath.get('.vibe/agent/_common-rules.md')?.reason, 'common-rules-injected-separately');
    assert.equal(diagnostic.summary?.inject, 1);
    assert.equal(diagnostic.summary?.missing, 1);
    assert.equal(diagnostic.summary?.skipped, 2);
  });

  it('diagnoses transitive stdin markdown injection without invoking codex', async () => {
    const binDir = await makeTempDir('run-codex-diagnostic-transitive-bin-');
    const cwd = await makeTempDir('run-codex-diagnostic-transitive-');
    await writeExecutable(path.join(binDir, 'codex'), '#!/usr/bin/env bash\necho "codex invoked" >&2\nexit 66\n');
    await mkdir(path.join(cwd, 'docs', 'context'), { recursive: true });
    await writeFile(
      path.join(cwd, 'docs', 'context', 'parent.md'),
      [
        '# Parent',
        '',
        'Read docs/context/ignored.md as ordinary prose.',
        '<!-- BEGIN:TEST:SHARDS -->',
        '- `docs/context/child.md`',
        '<!-- END:TEST:SHARDS -->',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(path.join(cwd, 'docs', 'context', 'child.md'), '# Child\n\nTransitive shard body.\n', 'utf8');
    await writeFile(path.join(cwd, 'docs', 'context', 'ignored.md'), '# Ignored\n\nOrdinary link body.\n', 'utf8');

    const child = spawnSync(bashCommand ?? 'bash', [bashScriptPath, '--diagnose-md-injection', '-'], {
      cwd,
      env: shellEnv(binDir, { VIBE_SPRINT_ID: '', VIBE_SKIP_AGENT_SESSION_START: '0' }),
      input: 'Use docs/context/parent.md for this task.',
      encoding: 'utf8',
    });

    assert.equal(child.status, 0, child.stderr);
    assert.doesNotMatch(child.stderr, /codex invoked|codex CLI not found/);

    const diagnostic = JSON.parse(child.stdout) as {
      scanMode?: string;
      referencedMarkdown?: Array<{ path?: string; status?: string }>;
      summary?: { inject?: number };
    };
    const byPath = new Map((diagnostic.referencedMarkdown ?? []).map((entry) => [entry.path, entry]));
    assert.equal(diagnostic.scanMode, 'transitive');
    assert.equal(byPath.get('docs/context/parent.md')?.status, 'inject');
    assert.equal(byPath.get('docs/context/child.md')?.status, 'inject');
    assert.equal(byPath.has('docs/context/ignored.md'), false);
    assert.equal(diagnostic.summary?.inject, 2);
  });

  it('diagnoses Codex vibe-init wrapper injection through shared phase shards', async () => {
    const binDir = await makeTempDir('run-codex-diagnostic-vibe-init-bin-');
    await writeExecutable(path.join(binDir, 'codex'), '#!/usr/bin/env bash\necho "codex invoked" >&2\nexit 66\n');
    const child = spawnSync(bashCommand ?? 'bash', [bashScriptPath, '--diagnose-md-injection', '-'], {
      env: shellEnv(binDir, { VIBE_SPRINT_ID: '', VIBE_SKIP_AGENT_SESSION_START: '0' }),
      input: 'Use .codex/skills/vibe-init/SKILL.md for initialization.',
      encoding: 'utf8',
    });

    assert.equal(child.status, 0, child.stderr);
    assert.doesNotMatch(child.stderr, /codex invoked|codex CLI not found/);

    const diagnostic = JSON.parse(child.stdout) as {
      referencedMarkdown?: Array<{ path?: string; status?: string }>;
      summary?: { inject?: number; missing?: number; skipped?: number };
    };
    const byPath = new Map((diagnostic.referencedMarkdown ?? []).map((entry) => [entry.path, entry]));
    for (const expectedPath of [
      '.codex/skills/vibe-init/SKILL.md',
      '.claude/skills/vibe-init/SKILL.md',
      '.claude/skills/vibe-init/phases/phase-2-providers.md',
      '.claude/skills/vibe-init/phases/phase-3-interview.md',
      '.claude/skills/vibe-init/phases/phase-4-complete.md',
      '.claude/skills/vibe-init/phases/rules.md',
    ]) {
      assert.equal(byPath.get(expectedPath)?.status, 'inject', expectedPath);
    }
    assert.equal(diagnostic.summary?.inject, 6);
    assert.equal(diagnostic.summary?.missing, 0);
    assert.equal(diagnostic.summary?.skipped, 0);
  });

  it('diagnoses Codex vibe-review wrapper injection through shared section shards', async () => {
    const binDir = await makeTempDir('run-codex-diagnostic-vibe-review-bin-');
    await writeExecutable(path.join(binDir, 'codex'), '#!/usr/bin/env bash\necho "codex invoked" >&2\nexit 66\n');
    const child = spawnSync(bashCommand ?? 'bash', [bashScriptPath, '--diagnose-md-injection', '-'], {
      env: shellEnv(binDir, { VIBE_SPRINT_ID: '', VIBE_SKIP_AGENT_SESSION_START: '0' }),
      input: 'Use .codex/skills/vibe-review/SKILL.md for harness review.',
      encoding: 'utf8',
    });

    assert.equal(child.status, 0, child.stderr);
    assert.doesNotMatch(child.stderr, /codex invoked|codex CLI not found/);

    const diagnostic = JSON.parse(child.stdout) as {
      referencedMarkdown?: Array<{ path?: string; status?: string }>;
      summary?: { inject?: number; missing?: number; skipped?: number };
    };
    const byPath = new Map((diagnostic.referencedMarkdown ?? []).map((entry) => [entry.path, entry]));
    for (const expectedPath of [
      '.codex/skills/vibe-review/SKILL.md',
      '.claude/skills/vibe-review/SKILL.md',
      '.claude/skills/vibe-review/sections/protocol.md',
      '.claude/skills/vibe-review/sections/rubric-and-findings.md',
      '.claude/skills/vibe-review/sections/automatic-checks.md',
      '.claude/skills/vibe-review/sections/report-shape.md',
    ]) {
      assert.equal(byPath.get(expectedPath)?.status, 'inject', expectedPath);
    }
    assert.equal(diagnostic.summary?.inject, 6);
    assert.equal(diagnostic.summary?.missing, 0);
    assert.equal(diagnostic.summary?.skipped, 0);
  });

  it('diagnoses Codex vibe-interview wrapper injection through shared section shards', async () => {
    const binDir = await makeTempDir('run-codex-diagnostic-vibe-interview-bin-');
    await writeExecutable(path.join(binDir, 'codex'), '#!/usr/bin/env bash\necho "codex invoked" >&2\nexit 66\n');
    const child = spawnSync(bashCommand ?? 'bash', [bashScriptPath, '--diagnose-md-injection', '-'], {
      env: shellEnv(binDir, { VIBE_SPRINT_ID: '', VIBE_SKIP_AGENT_SESSION_START: '0' }),
      input: 'Use .codex/skills/vibe-interview/SKILL.md for native interview.',
      encoding: 'utf8',
    });

    assert.equal(child.status, 0, child.stderr);
    assert.doesNotMatch(child.stderr, /codex invoked|codex CLI not found/);

    const diagnostic = JSON.parse(child.stdout) as {
      referencedMarkdown?: Array<{ path?: string; status?: string }>;
      summary?: { inject?: number; missing?: number; skipped?: number };
    };
    const byPath = new Map((diagnostic.referencedMarkdown ?? []).map((entry) => [entry.path, entry]));
    for (const expectedPath of [
      '.codex/skills/vibe-interview/SKILL.md',
      '.claude/skills/vibe-interview/SKILL.md',
      '.claude/skills/vibe-interview/sections/invocation-protocol.md',
      '.claude/skills/vibe-interview/sections/operating-modes.md',
      '.claude/skills/vibe-interview/sections/termination-consensus.md',
      '.claude/skills/vibe-interview/sections/output-artifacts.md',
    ]) {
      assert.equal(byPath.get(expectedPath)?.status, 'inject', expectedPath);
    }
    assert.equal(diagnostic.summary?.inject, 6);
    assert.equal(diagnostic.summary?.missing, 0);
    assert.equal(diagnostic.summary?.skipped, 0);
  });

  it('diagnoses Codex vibe-iterate wrapper injection through shared phase shards', async () => {
    const binDir = await makeTempDir('run-codex-diagnostic-vibe-iterate-bin-');
    await writeExecutable(path.join(binDir, 'codex'), '#!/usr/bin/env bash\necho "codex invoked" >&2\nexit 66\n');
    const child = spawnSync(bashCommand ?? 'bash', [bashScriptPath, '--diagnose-md-injection', '-'], {
      env: shellEnv(binDir, { VIBE_SPRINT_ID: '', VIBE_SKIP_AGENT_SESSION_START: '0' }),
      input: 'Use .codex/skills/vibe-iterate/SKILL.md for the next iteration.',
      encoding: 'utf8',
    });

    assert.equal(child.status, 0, child.stderr);
    assert.doesNotMatch(child.stderr, /codex invoked|codex CLI not found/);

    const diagnostic = JSON.parse(child.stdout) as {
      referencedMarkdown?: Array<{ path?: string; status?: string }>;
      summary?: { inject?: number; missing?: number; skipped?: number };
    };
    const byPath = new Map((diagnostic.referencedMarkdown ?? []).map((entry) => [entry.path, entry]));
    for (const expectedPath of [
      '.codex/skills/vibe-iterate/SKILL.md',
      '.claude/skills/vibe-iterate/SKILL.md',
      '.claude/skills/vibe-iterate/phases/phase-0-load-state.md',
      '.claude/skills/vibe-iterate/phases/phase-1-differential-interview.md',
      '.claude/skills/vibe-iterate/phases/phase-2-roadmap-history.md',
      '.claude/skills/vibe-iterate/phases/phase-4-sprints-report.md',
    ]) {
      assert.equal(byPath.get(expectedPath)?.status, 'inject', expectedPath);
    }
    assert.equal(diagnostic.summary?.inject, 6);
    assert.equal(diagnostic.summary?.missing, 0);
    assert.equal(diagnostic.summary?.skipped, 0);
  });

  it('diagnoses Codex vibe-sync wrapper injection through the shared runbook', async () => {
    const binDir = await makeTempDir('run-codex-diagnostic-vibe-sync-bin-');
    await writeExecutable(path.join(binDir, 'codex'), '#!/usr/bin/env bash\necho "codex invoked" >&2\nexit 66\n');
    const child = spawnSync(bashCommand ?? 'bash', [bashScriptPath, '--diagnose-md-injection', '-'], {
      env: shellEnv(binDir, { VIBE_SPRINT_ID: '', VIBE_SKIP_AGENT_SESSION_START: '0' }),
      input: 'Use .codex/skills/vibe-sync/SKILL.md for harness sync.',
      encoding: 'utf8',
    });

    assert.equal(child.status, 0, child.stderr);
    assert.doesNotMatch(child.stderr, /codex invoked|codex CLI not found/);

    const diagnostic = JSON.parse(child.stdout) as {
      referencedMarkdown?: Array<{ path?: string; status?: string }>;
      summary?: { inject?: number; missing?: number; skipped?: number };
    };
    const byPath = new Map((diagnostic.referencedMarkdown ?? []).map((entry) => [entry.path, entry]));
    for (const expectedPath of [
      '.codex/skills/vibe-sync/SKILL.md',
      '.claude/skills/vibe-sync/SKILL.md',
    ]) {
      assert.equal(byPath.get(expectedPath)?.status, 'inject', expectedPath);
    }
    assert.equal(diagnostic.summary?.inject, 2);
    assert.equal(diagnostic.summary?.missing, 0);
    assert.equal(diagnostic.summary?.skipped, 0);
  });

  it('diagnoses compact Codex wrappers through their shared runbooks', async () => {
    const binDir = await makeTempDir('run-codex-diagnostic-compact-skills-bin-');
    await writeExecutable(path.join(binDir, 'codex'), '#!/usr/bin/env bash\necho "codex invoked" >&2\nexit 66\n');

    for (const skillName of ['goal-to-plan', 'maintain-context', 'self-qa', 'vibe-sprint-mode', 'write-report']) {
      const child = spawnSync(bashCommand ?? 'bash', [bashScriptPath, '--diagnose-md-injection', '-'], {
        env: shellEnv(binDir, { VIBE_SPRINT_ID: '', VIBE_SKIP_AGENT_SESSION_START: '0' }),
        input: `Use .codex/skills/${skillName}/SKILL.md for this workflow.`,
        encoding: 'utf8',
      });

      assert.equal(child.status, 0, `${skillName}\n${child.stderr}`);
      assert.doesNotMatch(child.stderr, /codex invoked|codex CLI not found/);

      const diagnostic = JSON.parse(child.stdout) as {
        referencedMarkdown?: Array<{ path?: string; status?: string }>;
        summary?: { inject?: number; missing?: number; skipped?: number };
      };
      const byPath = new Map((diagnostic.referencedMarkdown ?? []).map((entry) => [entry.path, entry]));
      assert.equal(byPath.get(`.codex/skills/${skillName}/SKILL.md`)?.status, 'inject', skillName);
      assert.equal(byPath.get(`.claude/skills/${skillName}/SKILL.md`)?.status, 'inject', skillName);
      assert.equal(diagnostic.summary?.inject, 2, skillName);
      assert.equal(diagnostic.summary?.missing, 0, skillName);
      assert.equal(diagnostic.summary?.skipped, 0, skillName);
    }
  });

  it('marks argv markdown references as not injected at runtime', async () => {
    const binDir = await makeTempDir('run-codex-diagnostic-argv-bin-');
    const child = spawnSync(bashCommand ?? 'bash', [bashScriptPath, '--dry-run-md-injection', 'Use docs/context/qa.md.'], {
      env: shellEnv(binDir, { VIBE_SPRINT_ID: '' }),
      input: '',
      encoding: 'utf8',
    });

    assert.equal(child.status, 0, child.stderr);
    const diagnostic = JSON.parse(child.stdout) as {
      promptSource?: string;
      runtimeInjectionApplies?: boolean;
      referencedMarkdown?: Array<{ path?: string; status?: string; reason?: string }>;
      summary?: { skipped?: number };
    };
    assert.equal(diagnostic.promptSource, 'argv');
    assert.equal(diagnostic.runtimeInjectionApplies, false);
    assert.deepEqual(diagnostic.referencedMarkdown?.[0], {
      reference: 'docs/context/qa.md',
      path: 'docs/context/qa.md',
      status: 'argv-not-injected',
      reason: 'referenced-md-injection-only-applies-to-stdin-prompts',
    });
    assert.equal(diagnostic.summary?.skipped, 1);
  });

  it('emits a dashboard attention event after successful Codex execution when enabled', async () => {
    const binDir = await createShellStubBin('ok');
    const cwd = await makeTempDir('run-codex-attention-');
    const child = spawnSync(bashCommand ?? 'bash', [bashScriptPath, 'prompt text'], {
      cwd,
      env: shellEnv(binDir, { CODEX_RETRY: '1', VIBE_DISABLE_ATTENTION: '0' }),
      input: '',
      encoding: 'utf8',
    });

    assert.equal(child.status, 0, child.stderr);

    const raw = await readFile(path.join(cwd, '.vibe', 'agent', 'attention.jsonl'), 'utf8');
    const event = JSON.parse(raw.trim().split(/\r?\n/)[0] ?? '{}') as Record<string, unknown>;
    assert.equal(event.type, 'attention-needed');
    assert.equal(event.severity, 'info');
    assert.equal(event.source, 'codex-wrapper');
    assert.equal(event.provider, 'codex');
    assert.equal(event.title, 'Codex run completed');
  });

  it('prepends the Windows sandbox limitation header on Windows hosts', async () => {
    const binDir = await createShellStubBin('stdin');
    await writeUnameStub(binDir, 'MINGW64_NT-10.0');
    const rules = await readFile(rulesPath, 'utf8');
    const firstRuleLine = rules.split(/\r?\n/).find((line) => line.length > 0) ?? '';
    const child = spawnSync(bashCommand ?? 'bash', [bashScriptPath, '-'], {
      env: shellEnv(binDir, { OS: '' }),
      input: 'hello from stdin',
      encoding: 'utf8',
    });

    assert.equal(child.status, 0);
    assert.match(child.stderr, /injected Windows sandbox limitation header/);
    const headerIndex = child.stdout.indexOf('## Host OS sandbox limitation (auto-injected)');
    const commonRulesIndex = child.stdout.indexOf(firstRuleLine);
    const promptIndex = child.stdout.indexOf('hello from stdin');
    assert.ok(headerIndex >= 0);
    assert.ok(commonRulesIndex > headerIndex);
    assert.ok(promptIndex > commonRulesIndex);
  });

  it('does not prepend the Windows sandbox limitation header on non-Windows hosts', { skip: process.platform === 'win32' }, async () => {
    const binDir = await createShellStubBin('stdin');
    await writeUnameStub(binDir, 'Linux');
    const child = spawnSync(bashCommand ?? 'bash', [bashScriptPath, '-'], {
      env: shellEnv(binDir, { OS: '' }),
      input: 'hello from stdin',
      encoding: 'utf8',
    });

    assert.equal(child.status, 0);
    assert.doesNotMatch(child.stderr, /injected Windows sandbox limitation header/);
    assert.doesNotMatch(child.stdout, /## Host OS sandbox limitation \(auto-injected\)/);
  });

  it('invokes status-tick after successful codex run when VIBE_SPRINT_ID is set', async () => {
    const binDir = await createShellStubBin('tokens');
    const cwd = await makeTempDir('run-codex-status-tick-');
    const child = spawnSync(bashCommand ?? 'bash', [bashScriptPath, 'prompt text'], {
      cwd,
      env: shellEnv(binDir, {
        CODEX_RETRY: '1',
        VIBE_SPRINT_ID: 'sprint-example',
      }),
      input: '',
      encoding: 'utf8',
    });

    assert.equal(child.status, 0);
    assert.match(child.stderr, /status-tick: ticked tokens=1234 sprint=sprint-example/);

    const tokens = await readTokensJson(cwd);
    assert.equal(tokens.sprintTokens['sprint-example'], 1234);
    assert.ok(tokens.elapsedSeconds >= 0);
  });

  it('extracts tokens from the current "tokens used" codex output format', async () => {
    const { child, cwd } = await runShellStatusTickFixture('tokens-used');

    assert.equal(child.status, 0);
    assert.match(child.stderr, /status-tick: ticked tokens=12345 sprint=sprint-example/);
    const tokens = await readTokensJson(cwd);
    assert.equal(tokens.cumulativeTokens, 12345);
    assert.equal(tokens.sprintTokens['sprint-example'], 12345);
  });

  it('extracts tokens from CRLF codex output', async () => {
    const { child, cwd } = await runShellStatusTickFixture('tokens-crlf');

    assert.equal(child.status, 0);
    assert.match(child.stderr, /status-tick: ticked tokens=99 sprint=sprint-example/);
    const tokens = await readTokensJson(cwd);
    assert.equal(tokens.cumulativeTokens, 99);
    assert.equal(tokens.sprintTokens['sprint-example'], 99);
  });

  it('skips status-tick when codex token output omits the number', async () => {
    const { child, cwd } = await runShellStatusTickFixture('tokens-malformed');

    assert.equal(child.status, 0);
    assert.match(child.stderr, /status-tick: skipped reason=no-tokens/);
    await assert.rejects(readFile(path.join(cwd, '.vibe', 'agent', 'tokens.json'), 'utf8'), {
      code: 'ENOENT',
    });
  });

  it('skips status-tick when sprint status handoff is idle', async () => {
    const binDir = await createShellStubBin('tokens');
    const cwd = await makeTempDir('run-codex-status-skip-');
    await writeFile(
      path.join(cwd, '.vibe', 'agent', 'sprint-status.json'),
      JSON.stringify({ handoff: { currentSprintId: 'idle' } }),
      'utf8',
    ).catch(async (error: unknown) => {
      if ((error as { code?: string }).code !== 'ENOENT') {
        throw error;
      }
      await mkdir(path.join(cwd, '.vibe', 'agent'), { recursive: true });
      await writeFile(
        path.join(cwd, '.vibe', 'agent', 'sprint-status.json'),
        JSON.stringify({ handoff: { currentSprintId: 'idle' } }),
        'utf8',
      );
    });

    const child = spawnSync(bashCommand ?? 'bash', [bashScriptPath, 'prompt text'], {
      cwd,
      env: shellEnv(binDir, {
        CODEX_RETRY: '1',
        VIBE_SPRINT_ID: '',
      }),
      input: '',
      encoding: 'utf8',
    });

    assert.equal(child.status, 0);
    assert.match(child.stderr, /status-tick: skipped reason=no-sprint/);
    await assert.rejects(readFile(path.join(cwd, '.vibe', 'agent', 'tokens.json'), 'utf8'), {
      code: 'ENOENT',
    });
  });
});

describe('run-codex.cmd wrapper', { skip: process.platform !== 'win32' }, () => {
  it('returns normalized version output for healthy codex', async () => {
    const binDir = await createCmdStubBin('ok');
    const { stdout } = await execFile(shellPath, ['/d', '/c', cmdScriptPath, '--health'], {
      env: shellEnv(binDir),
    });

    assert.equal(stdout.trim(), 'codex-cli 0.9.1');
  });

  it('forwards stdin through the native cmd wrapper', async () => {
    const binDir = await createCmdStubBin('stdin');
    const child = spawnSync(shellPath, ['/d', '/c', cmdScriptPath, '-'], {
      env: shellEnv(binDir, { VIBE_SPRINT_ID: '' }),
      input: 'hello from cmd stdin',
      encoding: 'utf8',
    });

    assert.equal(child.status, 0);
    assert.match(child.stdout, /hello from cmd stdin/);
  });

  it('invokes status-tick after successful native cmd runs when VIBE_SPRINT_ID is set', async () => {
    const binDir = await createCmdStubBin('ok');
    const cwd = await makeTempDir('run-codex-cmd-status-tick-');
    const child = spawnSync(shellPath, ['/d', '/c', cmdScriptPath, 'prompt text'], {
      cwd,
      env: shellEnv(binDir, {
        VIBE_SPRINT_ID: 'sprint-cmd',
      }),
      input: '',
      encoding: 'utf8',
    });

    assert.equal(child.status, 0);
    const tokens = await readTokensJson(cwd);
    assert.equal(tokens.sprintTokens['sprint-cmd'], 0);
    assert.ok(tokens.elapsedSeconds >= 0);
  });
});
