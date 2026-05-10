import type { FormEvent } from "react";

type AuthTokenPanelProps = {
  proxyInput: string;
  modelLabelInput: string;
  tokenInput: string;
  onProxyInputChange: (value: string) => void;
  onModelLabelInputChange: (value: string) => void;
  onTokenInputChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent) => void;
};

export function AuthTokenPanel({
  proxyInput,
  modelLabelInput,
  tokenInput,
  onProxyInputChange,
  onModelLabelInputChange,
  onTokenInputChange,
  onCancel,
  onSubmit
}: AuthTokenPanelProps) {
  return (
    <form className="auth-panel" onSubmit={onSubmit}>
      <label>
        <span>Agent proxy URL</span>
        <input
          value={proxyInput}
          onChange={(event) => onProxyInputChange(event.target.value)}
          placeholder="http://127.0.0.1:8787/agent/stream"
        />
      </label>
      <label>
        <span>Label</span>
        <input
          value={modelLabelInput}
          onChange={(event) => onModelLabelInputChange(event.target.value)}
          placeholder="oauth-token"
        />
      </label>
      <label className="token-field">
        <span>OAuth access token</span>
        <textarea
          value={tokenInput}
          onChange={(event) => onTokenInputChange(event.target.value)}
          placeholder="Paste token"
          spellCheck={false}
        />
      </label>
      <div className="auth-panel-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary">
          Save
        </button>
      </div>
    </form>
  );
}
