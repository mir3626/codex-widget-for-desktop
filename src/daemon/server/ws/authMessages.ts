import type { ClientMessage } from "../../../shared/protocol.js";
import { broadcast, send } from "../events.js";
import { resetAgentSession } from "../runtime/sessionReset.js";
import { syncCodexAppServer } from "../runtime/codexAppServerThread.js";
import type { MessageRouterContext } from "./context.js";

export async function handleAuthMessage(message: ClientMessage, context: MessageRouterContext): Promise<boolean> {
  const { socket, auth, clients, agentSession, codexAppServer } = context;

  if (message.type === "auth.start") {
    try {
      const url = auth.startSignIn(() => {
        broadcast(clients, { type: "auth.status", auth: auth.getStatus() });
        syncCodexAppServer(auth, codexAppServer);
      });
      if (url) {
        send(socket, { type: "auth.url", url });
      }
      send(socket, { type: "auth.status", auth: auth.getStatus() });
    } catch (error) {
      send(socket, {
        type: "error",
        message: error instanceof Error ? error.message : "Unable to start OAuth sign-in."
      });
      send(socket, { type: "auth.status", auth: auth.getStatus() });
    }
    return true;
  }

  if (message.type === "auth.logout") {
    auth.logout();
    resetAgentSession(agentSession);
    await codexAppServer.close();
    broadcast(clients, { type: "auth.status", auth: auth.getStatus() });
    return true;
  }

  if (message.type === "auth.save-token") {
    try {
      auth.completeTokenEntry(
        new URLSearchParams({
          access_token: message.accessToken,
          proxy_url: message.proxyUrl,
          model_label: message.modelLabel ?? ""
        })
      );
      await codexAppServer.close();
      broadcast(clients, { type: "auth.status", auth: auth.getStatus() });
    } catch (error) {
      send(socket, {
        type: "error",
        message: error instanceof Error ? error.message : "Unable to save OAuth token."
      });
      send(socket, { type: "auth.status", auth: auth.getStatus() });
    }
    return true;
  }

  return false;
}
