import type { CSSProperties, PointerEvent } from "react";
import mascotSpriteUrl from "../assets/mascot-motion-sprite.png";

type MascotSpriteProps = {
  className: string;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
};

export function MascotSprite({ className, onPointerDown }: MascotSpriteProps) {
  const style = {
    "--mascot-sprite-url": `url(${mascotSpriteUrl})`
  } as CSSProperties;

  return (
    <div
      className={className}
      style={style}
      role="presentation"
      aria-hidden="true"
      onPointerDown={onPointerDown}
    />
  );
}
