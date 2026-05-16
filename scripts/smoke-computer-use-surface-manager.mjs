#!/usr/bin/env node
import assert from "node:assert/strict";
import { ExecutionSurfaceManager } from "../dist/daemon/computer-use/index.js";

const manager = new ExecutionSurfaceManager();
assert.equal(manager.list().length >= 6, true, "default surfaces should be registered");

const defaultSurface = manager.select({ userRequest: "Open a public docs page" });
assert.equal(defaultSurface.surface.kind, "isolated_browser");
assert.equal(defaultSurface.requiredGrants.length, 0);

const artifactSurface = manager.select({ userRequest: "OpenAI docs 조사해서 PDF 보고서로 저장해줘" });
assert.equal(artifactSurface.surface.kind, "tool_workspace");
assert.equal(artifactSurface.requiredGrants.includes("generated_code.runtime_workspace"), true);

const profileSurface = manager.select({ requiresBrowserProfile: true });
assert.equal(profileSurface.surface.kind, "regular_browser_extension");
assert.equal(profileSurface.requiredGrants.includes("browser.profile"), true);

const terminalSurface = manager.select({ requiresTerminal: true });
assert.equal(terminalSurface.surface.kind, "pty_workspace");
assert.equal(terminalSurface.requiredGrants.includes("terminal.command_allowlist"), true);

const foregroundSurface = manager.select({ requiresForeground: true });
assert.equal(foregroundSurface.surface.kind, "foreground_desktop_watch");
assert.equal(foregroundSurface.requiredGrants.includes("desktop.foreground_watch"), true);
assert.equal(foregroundSurface.requiredGrants.includes("desktop.abort_on_user_input"), true);

console.log("computer use surface manager smoke ok");
