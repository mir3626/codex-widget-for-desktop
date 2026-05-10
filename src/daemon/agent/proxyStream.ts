export async function readProxyResponseText(
  response: Response,
  signal: AbortSignal,
  appendDelta: (delta: string) => void
): Promise<void> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    appendDelta(extractText(await response.json()) ?? "");
    return;
  }
  if (response.body && contentType.includes("text/event-stream")) {
    await readSseStream(response.body, signal, appendDelta);
    return;
  }
  if (response.body && contentType.includes("application/x-ndjson")) {
    await readNdjsonStream(response.body, signal, appendDelta);
    return;
  }
  if (response.body) {
    await readTextStream(response.body, signal, appendDelta);
    return;
  }
  throw new Error("OAuth proxy response did not include a body.");
}

async function readSseStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  appendDelta: (delta: string) => void
): Promise<void> {
  const dataLines: string[] = [];
  const flushEvent = () => {
    if (dataLines.length === 0) {
      return;
    }
    const payload = dataLines.join("\n");
    dataLines.length = 0;
    if (payload === "[DONE]") {
      return;
    }
    appendDelta(extractText(parseMaybeJson(payload)) ?? "");
  };

  await readLineStream(body, signal, (line) => {
    if (line === "") {
      flushEvent();
      return;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  });
  flushEvent();
}

async function readNdjsonStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  appendDelta: (delta: string) => void
): Promise<void> {
  await readLineStream(body, signal, (line) => {
    if (!line.trim()) {
      return;
    }
    appendDelta(extractText(parseMaybeJson(line)) ?? "");
  });
}

async function readLineStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onLine: (line: string) => void
): Promise<void> {
  let buffer = "";
  await readTextStream(body, signal, (chunk) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
      buffer = buffer.slice(newlineIndex + 1);
      onLine(line);
      newlineIndex = buffer.indexOf("\n");
    }
  });
  if (buffer.length > 0) {
    onLine(buffer.replace(/\r$/, ""));
  }
}

async function readTextStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onChunk: (chunk: string) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    onChunk(decoder.decode(value, { stream: true }));
  }

  const rest = decoder.decode();
  if (rest) {
    onChunk(rest);
  }
}

function parseMaybeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function extractText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (!isRecord(value)) {
    return undefined;
  }

  if (typeof value.delta === "string") {
    return value.delta;
  }
  if (typeof value.text === "string") {
    return value.text;
  }
  if (typeof value.output_text === "string") {
    return value.output_text;
  }
  if (typeof value.message === "string") {
    return value.message;
  }
  if (typeof value.content === "string") {
    return value.content;
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
