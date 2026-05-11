import { Ban, Check, CheckCheck } from "lucide-react";
import type { RuntimeInteraction, RuntimeInteractionDecision } from "../../shared/protocol.js";

type InteractionCardProps = {
  interaction: RuntimeInteraction;
  values: Record<string, string>;
  onChange: (interactionId: string, fieldId: string, value: string) => void;
  onRespond: (interaction: RuntimeInteraction, decision: RuntimeInteractionDecision, answerOverride?: Record<string, string>) => void;
};

export function InteractionCard({ interaction, values, onChange, onRespond }: InteractionCardProps) {
  const fields = interaction.fields ?? [];
  const choices = interaction.choices ?? [];
  const primaryFieldId = fields[0]?.id;

  return (
    <article className="interaction-card">
      <div className="interaction-copy">
        <strong>{interaction.title}</strong>
        <p>{interaction.body}</p>
      </div>
      {interaction.kind === "input" && choices.length > 0 ? (
        <div className="interaction-choice-list" aria-label="Suggested choices">
          {choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              className={primaryFieldId && values[primaryFieldId] === choice.value ? "selected" : undefined}
              onClick={() => {
                if (primaryFieldId) {
                  onRespond(interaction, "submit", { ...values, [primaryFieldId]: choice.value });
                }
              }}
            >
              <strong>{choice.label}</strong>
              {choice.visual?.kind === "bbox" ? <TargetPreview visual={choice.visual} /> : null}
              {choice.description ? <span>{choice.description}</span> : null}
              {choice.detail ? <small>{choice.detail}</small> : null}
            </button>
          ))}
        </div>
      ) : null}
      {interaction.kind === "input" ? (
        <div className="interaction-fields">
          {fields.map((field) => (
            <label key={field.id}>
              <span>{field.label}</span>
              {field.multiline ? (
                <textarea
                  value={values[field.id] ?? ""}
                  placeholder={field.placeholder}
                  onChange={(event) => onChange(interaction.id, field.id, event.target.value)}
                />
              ) : (
                <input
                  value={values[field.id] ?? ""}
                  placeholder={field.placeholder}
                  onChange={(event) => onChange(interaction.id, field.id, event.target.value)}
                />
              )}
            </label>
          ))}
        </div>
      ) : null}
      <div className="interaction-actions">
        <button
          type="button"
          className="primary"
          onClick={() => onRespond(interaction, interaction.kind === "input" ? "submit" : "approve")}
        >
          <Check size={13} />
          <span>{interaction.kind === "input" ? "Send" : "Allow"}</span>
        </button>
        {interaction.kind === "approval" ? (
          <button type="button" className="remember" onClick={() => onRespond(interaction, "always_allow")}>
            <CheckCheck size={13} />
            <span>Always allow</span>
          </button>
        ) : null}
        <button type="button" className="ghost" onClick={() => onRespond(interaction, "decline")}>
          <Ban size={13} />
          <span>Deny</span>
        </button>
      </div>
    </article>
  );
}

function TargetPreview({ visual }: {
  visual: NonNullable<NonNullable<RuntimeInteraction["choices"]>[number]["visual"]>;
}) {
  const viewport = visual.viewport ?? { width: 1024, height: 768 };
  const left = clampPercent((visual.bbox.x / viewport.width) * 100);
  const top = clampPercent((visual.bbox.y / viewport.height) * 100);
  const width = clampPercent((visual.bbox.w / viewport.width) * 100, 3, 100 - left);
  const height = clampPercent((visual.bbox.h / viewport.height) * 100, 6, 100 - top);
  return (
    <span className="interaction-target-preview" aria-hidden="true">
      <span
        className="interaction-target-box"
        style={{
          left: `${left}%`,
          top: `${top}%`,
          width: `${width}%`,
          height: `${height}%`
        }}
      />
      {visual.region ? <em>{visual.region}</em> : null}
    </span>
  );
}

function clampPercent(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}
