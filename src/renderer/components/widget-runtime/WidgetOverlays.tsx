import type { ComponentProps } from "react";
import { FloatingTooltipRoot } from "../FloatingTooltipRoot";
import { MascotSprite } from "../MascotSprite";
import { ScreenCropOverlay } from "../ScreenCropOverlay";

type WidgetOverlaysProps = {
  mascotSprite: ComponentProps<typeof MascotSprite>;
  screenCropOverlay: ComponentProps<typeof ScreenCropOverlay> | null;
};

export function WidgetOverlays({ mascotSprite, screenCropOverlay }: WidgetOverlaysProps) {
  return (
    <>
      <MascotSprite {...mascotSprite} />
      {screenCropOverlay ? <ScreenCropOverlay {...screenCropOverlay} /> : null}
      <FloatingTooltipRoot />
    </>
  );
}
