import type { ComponentProps } from "react";
import { BrowserActionMenu } from "../BrowserActionMenu";
import { ModeTabs } from "../ModeTabs";
import { VisionActionMenu } from "../VisionActionMenu";
import { VisionStatusPanel } from "../VisionStatusPanel";

type WidgetModeAreaProps = {
  modeTabs: ComponentProps<typeof ModeTabs>;
  browserActionMenu: ComponentProps<typeof BrowserActionMenu>;
  visionActionMenu: ComponentProps<typeof VisionActionMenu>;
  visionStatusPanel: ComponentProps<typeof VisionStatusPanel>;
};

export function WidgetModeArea({
  modeTabs,
  browserActionMenu,
  visionActionMenu,
  visionStatusPanel
}: WidgetModeAreaProps) {
  return (
    <>
      <ModeTabs {...modeTabs} />
      <BrowserActionMenu {...browserActionMenu} />
      <VisionActionMenu {...visionActionMenu} />
      <VisionStatusPanel {...visionStatusPanel} />
    </>
  );
}
