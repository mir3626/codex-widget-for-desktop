import { spawn } from 'node:child_process';

export function warnOpenFailure(target, error, stderr = process.stderr) {
  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`Warning: could not open ${target}: ${message}\n`);
}

export function openExternalTarget(
  targetPath,
  targetLabel,
  spawnFn = spawn,
  platform = process.platform,
  stderr = process.stderr,
) {
  const argsByPlatform =
    platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', targetPath]]
      : platform === 'darwin'
        ? ['open', [targetPath]]
        : ['xdg-open', [targetPath]];
  try {
    const child = spawnFn(argsByPlatform[0], argsByPlatform[1], {
      detached: true,
      stdio: 'ignore',
    });
    if (typeof child?.on === 'function') {
      child.on('error', (error) => warnOpenFailure(targetLabel, error, stderr));
    }
    if (typeof child?.unref === 'function') {
      child.unref();
    }
    return true;
  } catch (error) {
    warnOpenFailure(targetLabel, error, stderr);
    return false;
  }
}
