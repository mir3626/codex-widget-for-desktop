import { useEffect, useMemo, useRef } from "react";
import type { CSSProperties, PointerEvent } from "react";
import idleSpriteUrl from "../assets/mascot/mascot-idle-motion.webp";
import motionManifest from "../assets/mascot/mascot-motion-manifest.json";
import offlineSpriteUrl from "../assets/mascot/mascot-offline-motion.webp";
import visionSpriteUrl from "../assets/mascot/mascot-vision-motion.webp";
import workingSpriteUrl from "../assets/mascot/mascot-working-motion.webp";

export type MascotMotionStatus = "idle" | "working" | "recording" | "streaming" | "offline";

type MascotSpriteProps = {
  className: string;
  status: MascotMotionStatus;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
};

type ManifestStatus = keyof typeof motionManifest.statuses;

type MotionPattern = {
  id: string;
  start: number;
  length: number;
};

type MotionStatusData = {
  columns: number;
  rows: number;
  totalFrames: number;
  patterns: MotionPattern[];
};

const STATUS_TO_MANIFEST: Record<MascotMotionStatus, ManifestStatus> = {
  idle: "idle",
  working: "working",
  recording: "vision",
  streaming: "vision",
  offline: "offline"
};

const SPRITE_URLS: Record<MascotMotionStatus, string> = {
  idle: idleSpriteUrl,
  working: workingSpriteUrl,
  recording: visionSpriteUrl,
  streaming: visionSpriteUrl,
  offline: offlineSpriteUrl
};

const PLAYBACK_FRAME_MS = 1000 / 6;

function getStatusData(status: MascotMotionStatus): MotionStatusData {
  return motionManifest.statuses[STATUS_TO_MANIFEST[status]];
}

function framePosition(globalFrame: number, columns: number, rows: number): { x: string; y: string } {
  const column = globalFrame % columns;
  const row = Math.floor(globalFrame / columns);
  const x = columns > 1 ? `${(column / (columns - 1)) * 100}%` : "0%";
  const y = rows > 1 ? `${(row / (rows - 1)) * 100}%` : "0%";
  return { x, y };
}

function applyFrame(element: HTMLDivElement, statusData: MotionStatusData, frame: number): void {
  const clampedFrame = Math.min(statusData.totalFrames - 1, Math.max(0, frame));
  const position = framePosition(clampedFrame, statusData.columns, statusData.rows);
  element.style.setProperty("--mascot-position-x", position.x);
  element.style.setProperty("--mascot-position-y", position.y);
  element.style.setProperty("--mascot-frame-index", String(clampedFrame));
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function MascotSprite({ className, status, onPointerDown }: MascotSpriteProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const spriteUrl = SPRITE_URLS[status];
  const statusData = getStatusData(status);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) {
      return undefined;
    }

    const firstPattern = statusData.patterns[0];
    if (prefersReducedMotion()) {
      applyFrame(element, statusData, firstPattern.start);
      return undefined;
    }

    let animationFrame = 0;
    let previousTimestamp = performance.now();
    let accumulator = 0;
    const pattern = firstPattern;
    let localFrame = 0;
    applyFrame(element, statusData, pattern.start);

    const tick = (timestamp: number) => {
      const delta = Math.min(120, timestamp - previousTimestamp);
      previousTimestamp = timestamp;
      accumulator += delta;

      while (accumulator >= PLAYBACK_FRAME_MS) {
        localFrame += 1;
        if (localFrame >= pattern.length) {
          localFrame = 0;
        }
        accumulator -= PLAYBACK_FRAME_MS;
      }

      applyFrame(element, statusData, pattern.start + localFrame);
      animationFrame = requestAnimationFrame(tick);
    };

    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [status, statusData]);

  const style = useMemo(
    () =>
      ({
        "--mascot-sprite-url": `url(${spriteUrl})`,
        "--mascot-bg-size-x": `${statusData.columns * 100}%`,
        "--mascot-bg-size-y": `${statusData.rows * 100}%`,
        "--mascot-position-x": "0%",
        "--mascot-position-y": "0%",
        "--mascot-frame-index": "0"
      }) as CSSProperties,
    [spriteUrl, statusData]
  );

  return (
    <div
      ref={rootRef}
      className={className}
      style={style}
      role="presentation"
      aria-hidden="true"
      onPointerDown={onPointerDown}
    >
      <span className="mascot-frame" aria-hidden="true" />
    </div>
  );
}
