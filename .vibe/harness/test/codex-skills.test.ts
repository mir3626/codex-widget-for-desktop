import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

async function listSkillNames(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const names: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillPath = path.join(root, entry.name, 'SKILL.md');
    try {
      await readFile(skillPath, 'utf8');
      names.push(entry.name);
    } catch {
      // Non-command support directories are allowed.
    }
  }

  return names.sort();
}

describe('Codex skill parity', () => {
  it('provides Codex wrappers for every shared Claude skill', async () => {
    const claudeRoot = path.join(process.cwd(), '.claude', 'skills');
    const codexRoot = path.join(process.cwd(), '.codex', 'skills');
    const skillNames = await listSkillNames(claudeRoot);

    assert.deepEqual(await listSkillNames(codexRoot), skillNames);

    for (const skillName of skillNames) {
      const wrapper = await readFile(path.join(codexRoot, skillName, 'SKILL.md'), 'utf8');
      assert.match(wrapper, new RegExp(`\\.claude/skills/${skillName}/SKILL\\.md`));
      assert.match(
        wrapper,
        new RegExp(`BEGIN:VIBE-CODEX:SHARDS[\\s\\S]*\\.claude/skills/${skillName}/SKILL\\.md[\\s\\S]*END:VIBE-CODEX:SHARDS`),
      );
      assert.match(wrapper, /provider-neutral skill runbooks/);
      assert.match(wrapper, /repository-root path/);
      assert.doesNotMatch(wrapper, /\.\.\/\.\.\/\.\.\/\.claude\/skills/);
    }
  });

  it('documents the guarded init command in the Codex vibe-init wrapper', async () => {
    const wrapper = await readFile(path.join(process.cwd(), '.codex', 'skills', 'vibe-init', 'SKILL.md'), 'utf8');

    assert.match(wrapper, /npm run vibe:init -- --from-agent-skill --mode=human/);
    assert.match(wrapper, /--mode=agent --runtime=codex --one-liner/);
    assert.match(wrapper, /docs\/context\/product\.md/);
    assert.match(wrapper, /\.vibe\/agent\/sprint-status\.json/);
    assert.match(wrapper, /only allowed workflow/);
  });

  it('documents explicit review signal markers in shared vibe-init guidance', async () => {
    const sharedPath = path.join(process.cwd(), '.claude', 'skills', 'vibe-init', 'SKILL.md');
    const shared = await readFile(sharedPath, 'utf8');
    const shardPaths = Array.from(shared.matchAll(/`(\.claude\/skills\/vibe-init\/phases\/[^`]+\.md)`/g))
      .map((match) => match[1])
      .filter((shardPath): shardPath is string => typeof shardPath === 'string');
    const shardBodies = await Promise.all(
      shardPaths.map((shardPath) => readFile(path.join(process.cwd(), shardPath), 'utf8')),
    );
    const effectiveRunbook = [shared, ...shardBodies].join('\n');

    assert.match(effectiveRunbook, /BEGIN:PROJECT:review-signals/);
    assert.match(effectiveRunbook, /frontend = true\|false/);
    assert.match(effectiveRunbook, /bundle and browser-smoke opt-in review seeds/);
  });

  it('documents the Codex Orchestrator checkpoint workflow in maintain-context', async () => {
    const shared = await readFile(path.join(process.cwd(), '.claude', 'skills', 'maintain-context', 'SKILL.md'), 'utf8');
    const wrapper = await readFile(path.join(process.cwd(), '.codex', 'skills', 'maintain-context', 'SKILL.md'), 'utf8');

    assert.match(shared, /Codex does not provide Claude Code's native `PreCompact`/);
    assert.match(shared, /npm run vibe:checkpoint/);
    assert.match(shared, /Generator agents normally do not need this workflow/);
    assert.match(wrapper, /Codex main Orchestrator sessions/);
  });

  it('documents the downstream initialization boundary in Codex agent memory', async () => {
    const agents = await readFile(path.join(process.cwd(), 'AGENTS.md'), 'utf8');
    const commonRules = await readFile(path.join(process.cwd(), '.vibe', 'agent', '_common-rules.md'), 'utf8');

    for (const content of [agents, commonRules]) {
      assert.match(content, /Initialization boundary/);
      assert.match(content, /docs\/context\/product\.md/);
      assert.match(content, /\.vibe\/agent\/sprint-status\.json/);
      assert.match(content, /npm run vibe:init -- --from-agent-skill/);
      assert.match(content, /init\/bootstrap\/harness process failure/);
    }
  });

  it('documents the partial-init review exception in Codex vibe-review guidance', async () => {
    const wrapper = await readFile(path.join(process.cwd(), '.codex', 'skills', 'vibe-review', 'SKILL.md'), 'utf8');
    const sharedPath = path.join(process.cwd(), '.claude', 'skills', 'vibe-review', 'SKILL.md');
    const shared = await readFile(sharedPath, 'utf8');
    const shardPaths = Array.from(shared.matchAll(/`(\.claude\/skills\/vibe-review\/sections\/[^`]+\.md)`/g))
      .map((match) => match[1])
      .filter((shardPath): shardPath is string => typeof shardPath === 'string');
    const shardBodies = await Promise.all(
      shardPaths.map((shardPath) => readFile(path.join(process.cwd(), shardPath), 'utf8')),
    );
    const effectiveRunbook = [shared, ...shardBodies].join('\n');

    assert.match(wrapper, /partial or uninitialized checkout/);
    assert.match(effectiveRunbook, /\.vibe\/harness\/scripts\/vibe-review-inputs\.mjs --install/);
  });
});
