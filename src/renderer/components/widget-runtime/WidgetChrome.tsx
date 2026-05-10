import type { ComponentProps } from "react";
import { SessionStrip } from "../SessionStrip";
import { SystemStrip } from "../SystemStrip";
import { TitleBar } from "../TitleBar";
import { WidgetToast } from "./WidgetToast";

type WidgetChromeProps = {
  titleBar: ComponentProps<typeof TitleBar>;
  systemStrip: ComponentProps<typeof SystemStrip>;
  sessionStrip: ComponentProps<typeof SessionStrip>;
  toast: ComponentProps<typeof WidgetToast>;
};

export function WidgetChrome({ titleBar, systemStrip, sessionStrip, toast }: WidgetChromeProps) {
  return (
    <>
      <TitleBar {...titleBar} />
      <SystemStrip {...systemStrip} />
      <SessionStrip {...sessionStrip} />
      <WidgetToast {...toast} />
    </>
  );
}
