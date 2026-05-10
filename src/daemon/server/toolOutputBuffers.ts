const MAX_LEDGER_TOOL_OUTPUT_CHARS = 120_000;

export function appendToolOutputBuffer(
  buffers: Map<string, Map<string, string>>,
  requestId: string,
  tool: string,
  chunk: string
): void {
  if (!chunk) {
    return;
  }
  let byTool = buffers.get(requestId);
  if (!byTool) {
    byTool = new Map<string, string>();
    buffers.set(requestId, byTool);
  }
  const current = byTool.get(tool) ?? "";
  byTool.set(tool, `${current}${chunk}`.slice(-MAX_LEDGER_TOOL_OUTPUT_CHARS));
}

export function consumeToolOutputBuffer(
  buffers: Map<string, Map<string, string>>,
  requestId: string,
  tool: string
): string {
  const byTool = buffers.get(requestId);
  const output = byTool?.get(tool) ?? "";
  byTool?.delete(tool);
  if (byTool && byTool.size === 0) {
    buffers.delete(requestId);
  }
  return output;
}
