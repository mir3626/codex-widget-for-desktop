import type { ComponentProps } from "react";
import { ConversationPanel } from "../ConversationPanel";
import { SettingsPanel } from "../SettingsPanel";
import { AuthTokenPanel } from "./AuthTokenPanel";

type WidgetBodyProps = {
  showSettings: boolean;
  showTokenForm: boolean;
  settingsPanel: ComponentProps<typeof SettingsPanel>;
  authTokenPanel: ComponentProps<typeof AuthTokenPanel>;
  conversationPanel: ComponentProps<typeof ConversationPanel>;
};

export function WidgetBody({
  showSettings,
  showTokenForm,
  settingsPanel,
  authTokenPanel,
  conversationPanel
}: WidgetBodyProps) {
  if (showSettings) {
    return <SettingsPanel {...settingsPanel} />;
  }

  if (showTokenForm) {
    return <AuthTokenPanel {...authTokenPanel} />;
  }

  return <ConversationPanel {...conversationPanel} />;
}
