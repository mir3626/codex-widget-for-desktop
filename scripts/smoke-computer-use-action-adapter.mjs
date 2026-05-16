#!/usr/bin/env node
import assert from "node:assert/strict";
import { normalizeComputerActionBatch } from "../dist/shared/protocol.js";

const batched = normalizeComputerActionBatch({
  actions: [
    { type: "click", x: 10, y: 20 },
    { type: "doubleClick", x: 11, y: 21, button: "right" },
    { type: "key_press", key: "Enter" },
    { type: "scroll", x: 0, y: 0, direction: "down" }
  ]
});
assert.equal(batched.sourceSchema, "openai_actions_array");
assert.equal(batched.blockedReason, undefined);
assert.deepEqual(batched.actions[0], { type: "click", x: 10, y: 20 });
assert.deepEqual(batched.actions[1], { type: "double_click", x: 11, y: 21, button: "right" });
assert.deepEqual(batched.actions[2], { type: "keypress", keys: ["Enter"] });
assert.equal(batched.actions[3].type, "scroll");
assert.equal(batched.actions[3].deltaY, 720);

const single = normalizeComputerActionBatch({
  action: { type: "type", text: "hello" }
});
assert.equal(single.sourceSchema, "openai_single_action");
assert.deepEqual(single.actions, [{ type: "type", text: "hello" }]);

const raw = normalizeComputerActionBatch({ type: "wait", durationMs: 250.4 });
assert.equal(raw.sourceSchema, "widget_native");
assert.deepEqual(raw.actions, [{ type: "wait", ms: 250 }]);
assert.equal(raw.warnings.some((warning) => warning.includes("raw action")), true);

const unknown = normalizeComputerActionBatch({
  actions: [{ type: "click", x: 1, y: 2 }, { type: "format_disk", x: 1, y: 2 }]
});
assert.equal(unknown.actions.length, 0, "unknown action blocks the whole batch");
assert.match(unknown.blockedReason ?? "", /Unknown or unsafe/);

const badDrag = normalizeComputerActionBatch({ action: { type: "drag", path: [{ x: 0, y: 0 }] } });
assert.equal(badDrag.actions.length, 0);
assert.match(badDrag.blockedReason ?? "", /Unknown or unsafe/);

console.log("computer use action adapter smoke ok");
