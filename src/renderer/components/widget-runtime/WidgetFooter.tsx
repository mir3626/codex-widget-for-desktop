import type { ComponentProps } from "react";
import { ActivityLog } from "../ActivityLog";
import { ModelControls } from "../ModelControls";
import { PromptComposer } from "../PromptComposer";

type WidgetFooterProps = {
  promptComposer: ComponentProps<typeof PromptComposer>;
  modelControls: ComponentProps<typeof ModelControls>;
  activityLog: ComponentProps<typeof ActivityLog>;
};

export function WidgetFooter({
  promptComposer,
  modelControls,
  activityLog
}: WidgetFooterProps) {
  return (
    <>
      <PromptComposer {...promptComposer} />
      <ModelControls {...modelControls} />
      <ActivityLog {...activityLog} />
    </>
  );
}
