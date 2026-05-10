import { useState, type FormEvent } from "react";
import type {
  AuthStatus,
  ClientMessage
} from "../../shared/protocol.js";
import type { LogLine } from "../types";

type UseWidgetAuthControllerInput = {
  send(message: ClientMessage): boolean;
  appendLog(text: string, tone: LogLine["tone"]): void;
  onTokenAuthStart?(): void;
};

export function useWidgetAuthController({
  send,
  appendLog,
  onTokenAuthStart
}: UseWidgetAuthControllerInput) {
  const [auth, setAuth] = useState<AuthStatus>({
    mode: "mock",
    configured: false,
    authenticated: false,
    signInAvailable: false,
    signInMethod: null
  });
  const [showTokenForm, setShowTokenForm] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [proxyInput, setProxyInput] = useState("http://127.0.0.1:8787/agent/stream");
  const [modelLabelInput, setModelLabelInput] = useState("oauth-token");

  function applyAuthStatus(nextAuth: AuthStatus, options?: { quiet?: boolean }) {
    setAuth(nextAuth);
    if (options?.quiet) {
      return;
    }
    if (nextAuth.authenticated) {
      setShowTokenForm(false);
      setTokenInput("");
      appendLog(nextAuth.signInMethod === "codex" ? "OpenAI signed in" : "oauth signed in", "tool");
    } else if (nextAuth.configured) {
      appendLog(nextAuth.reason ?? "sign-in required", "muted");
    }
    if (nextAuth.proxyUrl && !proxyInput.trim()) {
      setProxyInput(nextAuth.proxyUrl);
    }
    if (nextAuth.modelLabel && !modelLabelInput.trim()) {
      setModelLabelInput(nextAuth.modelLabel);
    }
  }

  function authAction() {
    if (auth.authenticated) {
      send({ type: "auth.logout" });
      return;
    }

    if (auth.signInMethod === "token") {
      onTokenAuthStart?.();
      setShowTokenForm(true);
      if (auth.proxyUrl) {
        setProxyInput(auth.proxyUrl);
      }
      if (auth.modelLabel) {
        setModelLabelInput(auth.modelLabel);
      }
      appendLog("oauth token required", "muted");
      return;
    }

    send({ type: "auth.start" });
  }

  function saveToken(event: FormEvent) {
    event.preventDefault();
    const accessToken = tokenInput.trim();
    const proxyUrl = proxyInput.trim();
    if (!accessToken || !proxyUrl) {
      appendLog("token and proxy required", "error");
      return;
    }

    send({
      type: "auth.save-token",
      accessToken,
      proxyUrl,
      modelLabel: modelLabelInput.trim() || "oauth-token"
    });
  }

  return {
    auth,
    setAuth,
    applyAuthStatus,
    showTokenForm,
    setShowTokenForm,
    tokenInput,
    setTokenInput,
    proxyInput,
    setProxyInput,
    modelLabelInput,
    setModelLabelInput,
    authAction,
    saveToken
  };
}
