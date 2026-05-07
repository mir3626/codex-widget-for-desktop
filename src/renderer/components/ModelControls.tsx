import {
  MODEL_OPTIONS,
  REASONING_EFFORT_OPTIONS,
  type ModelId,
  type ReasoningEffort
} from "../../shared/protocol.js";

type ModelControlsProps = {
  selectedModel: ModelId;
  reasoningEffort: ReasoningEffort;
  flashing: boolean;
  onModelChange: (value: string) => void;
  onReasoningChange: (value: string) => void;
};

export function ModelControls({
  selectedModel,
  reasoningEffort,
  flashing,
  onModelChange,
  onReasoningChange
}: ModelControlsProps) {
  return (
    <div className={flashing ? "model-row is-session-updated" : "model-row"} aria-label="Model settings">
      <label className="model-field model-field-wide" htmlFor="codex-widget-model-select">
        <span>Model</span>
        <span className="model-select-shell">
          <select
            id="codex-widget-model-select"
            aria-label="Model"
            value={selectedModel}
            onChange={(event) => onModelChange(event.target.value)}
          >
            {MODEL_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </span>
      </label>

      <label className="model-field" htmlFor="codex-widget-reasoning-select">
        <span>Reason</span>
        <span className="model-select-shell">
          <select
            id="codex-widget-reasoning-select"
            aria-label="Reasoning effort"
            value={reasoningEffort}
            onChange={(event) => onReasoningChange(event.target.value)}
          >
            {REASONING_EFFORT_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </span>
      </label>
    </div>
  );
}
