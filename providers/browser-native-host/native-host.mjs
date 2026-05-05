const DEFAULT_DAEMON_DOM_SNAPSHOT_URL = "http://127.0.0.1:4128/providers/dom/snapshot";
const MAX_MESSAGE_BYTES = 1024 * 1024;
const MAX_TEXT_CHARS = 20_000;

try {
  const messages = readNativeMessages(await readAllStdin());
  for (const message of messages) {
    await writeNativeMessage(await handleMessage(message));
  }
} catch (error) {
  await writeNativeMessage({
    ok: false,
    error: error instanceof Error ? error.message : "Native host failed."
  });
  process.exitCode = 1;
}

async function handleMessage(message) {
  if (!message || message.type !== "domSnapshot") {
    throw new Error("Unsupported native host message.");
  }

  const daemonUrl = normalizeDaemonSnapshotUrl(
    message.daemonUrl ?? process.env.CODEX_WIDGET_DAEMON_DOM_SNAPSHOT_URL ?? DEFAULT_DAEMON_DOM_SNAPSHOT_URL
  );
  const snapshot = normalizeSnapshot(message.snapshot);
  const response = await fetch(daemonUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(snapshot)
  });

  if (!response.ok) {
    throw new Error(`Daemon rejected DOM snapshot (${response.status}).`);
  }

  return {
    ok: true,
    transport: "nativeMessaging",
    status: response.status
  };
}

function normalizeSnapshot(value) {
  if (!value || typeof value !== "object") {
    throw new Error("DOM snapshot payload is missing.");
  }

  return {
    url: normalizeString(value.url, 2048),
    title: normalizeString(value.title, 512),
    selection: normalizeString(value.selection, 4000),
    text: normalizeString(value.text, MAX_TEXT_CHARS)
  };
}

function normalizeString(value, maxLength) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function normalizeDaemonSnapshotUrl(value) {
  if (typeof value !== "string") {
    return DEFAULT_DAEMON_DOM_SNAPSHOT_URL;
  }

  try {
    const url = new URL(value.trim());
    const isLocalHost = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    const isHttp = url.protocol === "http:";
    if (isLocalHost && isHttp && url.pathname === "/providers/dom/snapshot") {
      return url.toString();
    }
  } catch {
    // Fall through to the safe local default.
  }

  return DEFAULT_DAEMON_DOM_SNAPSHOT_URL;
}

async function readAllStdin() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_MESSAGE_BYTES) {
      throw new Error("Native message is too large.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function readNativeMessages(buffer) {
  const messages = [];
  let offset = 0;

  while (offset < buffer.length) {
    if (offset + 4 > buffer.length) {
      throw new Error("Native message length prefix is incomplete.");
    }

    const length = buffer.readUInt32LE(offset);
    offset += 4;

    if (length > MAX_MESSAGE_BYTES) {
      throw new Error("Native message exceeds max size.");
    }
    if (offset + length > buffer.length) {
      throw new Error("Native message body is incomplete.");
    }

    messages.push(JSON.parse(buffer.subarray(offset, offset + length).toString("utf8")));
    offset += length;
  }

  if (messages.length === 0) {
    throw new Error("No native messages were received.");
  }

  return messages;
}

function writeNativeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return new Promise((resolve, reject) => {
    process.stdout.write(Buffer.concat([header, body]), (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
