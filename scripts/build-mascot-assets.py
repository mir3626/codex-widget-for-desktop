from __future__ import annotations

import json
import math
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "src" / "renderer" / "assets" / "mascot"
RUNTIME_FRAME_SIZE = 256
SPRITE_COLUMNS = 10
FPS = 30


@dataclass(frozen=True)
class SequenceSheet:
    status: str
    source: str
    columns: int
    rows: int
    frames: int
    extraction: str = "grid"


@dataclass(frozen=True)
class FrameSource:
    image: Image.Image
    anchor: tuple[float, float]


SEQUENCE_SHEETS = (
    SequenceSheet("idle", "mascot-idle-sequence-source.png", 5, 6, 30, "components"),
    SequenceSheet("working", "mascot-working-sequence-source.png", 5, 6, 30, "components"),
    SequenceSheet("vision", "mascot-vision-sequence-source.png", 6, 5, 30, "components"),
    SequenceSheet("offline", "mascot-offline-sequence-source.png", 5, 6, 30, "components"),
)


def remove_chroma_key(image: Image.Image) -> Image.Image:
    rgba = np.array(image.convert("RGBA"), dtype=np.uint8)
    rgb = rgba[:, :, :3].astype(np.int16)
    alpha = rgba[:, :, 3].astype(np.int16)
    r = rgb[:, :, 0]
    g = rgb[:, :, 1]
    b = rgb[:, :, 2]
    max_rb = np.maximum(r, b)
    dominance = g - max_rb

    hard_key = (g >= 112) & (g >= r + 22) & (g >= b + 22) & (dominance > 28)
    soft_key = (g >= 100) & (dominance > 8)
    matte = np.full(alpha.shape, 255, dtype=np.int16)
    matte[hard_key] = 0
    transition = soft_key & ~hard_key
    matte[transition] = np.clip(np.round(255 * (1 - ((dominance[transition] - 8) / 30))), 0, 255)

    new_alpha = np.minimum(alpha, matte)
    spill = (new_alpha < 255) | ((g > max_rb + 8) & (g > 105))
    rgb[:, :, 1] = np.where(spill, np.minimum(g, max_rb + 2), g)

    rgba[:, :, :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    rgba[:, :, 3] = np.clip(new_alpha, 0, 255).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def tighten_alpha(image: Image.Image) -> Image.Image:
    rgba = np.array(image.convert("RGBA"), dtype=np.uint8)
    alpha = rgba[:, :, 3].astype(np.float32)
    low = alpha < 86
    mid = (alpha >= 86) & (alpha < 226)
    alpha[low] = 0
    alpha[mid] = np.clip(((alpha[mid] - 86) / 140) ** 0.72 * 255, 0, 255)
    rgba[:, :, 3] = alpha.astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def remove_edge_fragments(image: Image.Image) -> Image.Image:
    image = image.copy()
    pixels = image.load()
    width, height = image.size
    visited = bytearray(width * height)
    components: list[tuple[int, bool, list[int]]] = []

    for start_y in range(height):
        for start_x in range(width):
            start_index = start_y * width + start_x
            if visited[start_index] or pixels[start_x, start_y][3] <= 32:
                continue

            queue: deque[tuple[int, int]] = deque([(start_x, start_y)])
            visited[start_index] = 1
            area = 0
            touches_edge = False
            members: list[int] = []

            while queue:
                x, y = queue.popleft()
                index = y * width + x
                area += 1
                members.append(index)
                if x <= 1 or y <= 1 or x >= width - 2 or y >= height - 2:
                    touches_edge = True
                for ny in range(max(0, y - 1), min(height, y + 2)):
                    for nx in range(max(0, x - 1), min(width, x + 2)):
                        next_index = ny * width + nx
                        if visited[next_index] or pixels[nx, ny][3] <= 32:
                            continue
                        visited[next_index] = 1
                        queue.append((nx, ny))

            components.append((area, touches_edge, members))

    if not components:
        return image

    main_area = max(area for area, _, _ in components)
    main_members = next(members for area, _, members in components if area == main_area)
    main_member_ids = set(main_members)
    min_area = max(140, int(main_area * 0.004))
    for area, touches_edge, members in components:
        is_main_component = members and members[0] in main_member_ids
        if is_main_component:
            continue
        if area >= min_area and not touches_edge:
            continue
        for index in members:
            x = index % width
            y = index // width
            r, g, b, _ = pixels[x, y]
            pixels[x, y] = (r, g, b, 0)

    return image


def bleed_edge_colors(image: Image.Image, iterations: int = 8) -> Image.Image:
    rgba = np.array(image.convert("RGBA"), dtype=np.uint8)
    rgb = rgba[:, :, :3].astype(np.uint16)
    alpha = rgba[:, :, 3]
    known = alpha > 0

    for _ in range(iterations):
        unknown = ~known
        if not np.any(unknown):
            break
        rgb_sum = np.zeros_like(rgb, dtype=np.uint32)
        count = np.zeros(alpha.shape, dtype=np.uint16)

        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                src_y = slice(max(0, -dy), alpha.shape[0] - max(0, dy))
                dst_y = slice(max(0, dy), alpha.shape[0] - max(0, -dy))
                src_x = slice(max(0, -dx), alpha.shape[1] - max(0, dx))
                dst_x = slice(max(0, dx), alpha.shape[1] - max(0, -dx))
                neighbor_known = known[src_y, src_x]
                target_unknown = unknown[dst_y, dst_x] & neighbor_known
                if not np.any(target_unknown):
                    continue
                rgb_sum_view = rgb_sum[dst_y, dst_x]
                count_view = count[dst_y, dst_x]
                rgb_sum_view[target_unknown] += rgb[src_y, src_x][target_unknown]
                count_view[target_unknown] += 1

        fill = unknown & (count > 0)
        if not np.any(fill):
            break
        rgb[fill] = (rgb_sum[fill] // count[fill][:, None]).astype(np.uint16)
        known[fill] = True

    rgba[:, :, :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def compute_body_anchor(image: Image.Image) -> tuple[float, float]:
    rgba = np.array(image.convert("RGBA"), dtype=np.uint8)
    alpha = rgba[:, :, 3]
    opaque = alpha > 64
    ys, xs = np.where(opaque)
    if len(xs) == 0:
        return image.width / 2, image.height

    x0 = int(xs.min())
    x1 = int(xs.max()) + 1
    y0 = int(ys.min())
    y1 = int(ys.max()) + 1
    height = max(1, y1 - y0)
    focus_y0 = y0 + int(height * 0.38)
    focus_y1 = y0 + int(height * 0.96)
    r = rgba[:, :, 0]
    g = rgba[:, :, 1]
    b = rgba[:, :, 2]
    warm_fur = (r > 118) & (g > 68) & (r > b + 34) & (g > b + 8)
    focus = opaque & warm_fur
    focus[:focus_y0, :] = False
    focus[focus_y1:, :] = False
    focus_ys, focus_xs = np.where(focus)

    if len(focus_xs) < 180:
        focus = opaque.copy()
        focus[:focus_y0, :] = False
        focus[focus_y1:, :] = False
        focus_ys, focus_xs = np.where(focus)

    if len(focus_xs) == 0:
        anchor_x = (x0 + x1) / 2
    else:
        weights = alpha[focus_ys, focus_xs].astype(np.float32) / 255
        anchor_x = float(np.average(focus_xs, weights=weights))

    return anchor_x, float(y1)


def clean_tile(tile: Image.Image) -> FrameSource:
    image = bleed_edge_colors(tighten_alpha(remove_edge_fragments(remove_chroma_key(tile))))
    return FrameSource(image=image, anchor=compute_body_anchor(image))


def split_sheet(source: Image.Image, columns: int, rows: int, frame_count: int) -> Iterable[Image.Image]:
    width, height = source.size
    cell_width = width / columns
    cell_height = height / rows
    for index in range(frame_count):
        row = index // columns
        col = index % columns
        yield source.crop(
            (
                round(col * cell_width),
                round(row * cell_height),
                round((col + 1) * cell_width),
                round((row + 1) * cell_height),
            )
        )


def split_sheet_by_components(source: Image.Image, frame_count: int) -> list[FrameSource]:
    cleaned = tighten_alpha(remove_chroma_key(source))
    pixels = cleaned.load()
    width, height = cleaned.size
    visited = bytearray(width * height)
    components: list[tuple[int, tuple[int, int, int, int], list[int]]] = []

    for start_y in range(height):
        for start_x in range(width):
            start_index = start_y * width + start_x
            if visited[start_index] or pixels[start_x, start_y][3] <= 32:
                continue

            queue: deque[tuple[int, int]] = deque([(start_x, start_y)])
            visited[start_index] = 1
            area = 0
            min_x = max_x = start_x
            min_y = max_y = start_y
            members: list[int] = []

            while queue:
                x, y = queue.popleft()
                index = y * width + x
                area += 1
                members.append(index)
                min_x = min(min_x, x)
                max_x = max(max_x, x)
                min_y = min(min_y, y)
                max_y = max(max_y, y)
                for ny in range(max(0, y - 1), min(height, y + 2)):
                    for nx in range(max(0, x - 1), min(width, x + 2)):
                        next_index = ny * width + nx
                        if visited[next_index] or pixels[nx, ny][3] <= 32:
                            continue
                        visited[next_index] = 1
                        queue.append((nx, ny))

            if area >= 500:
                components.append((area, (min_x, min_y, max_x + 1, max_y + 1), members))

    if len(components) < frame_count:
        raise SystemExit(f"Only found {len(components)} mascot components, expected {frame_count}")

    components = sorted(components, key=lambda item: item[0], reverse=True)[:frame_count]
    components.sort(key=lambda item: ((item[1][1] + item[1][3]) / 2, (item[1][0] + item[1][2]) / 2))

    frames: list[FrameSource] = []
    for _, bbox, members in components:
        padding = 8
        x0 = max(0, bbox[0] - padding)
        y0 = max(0, bbox[1] - padding)
        x1 = min(width, bbox[2] + padding)
        y1 = min(height, bbox[3] + padding)
        frame = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
        frame_pixels = frame.load()
        member_ids = set(members)
        for index in member_ids:
            x = index % width
            y = index // width
            if x0 <= x < x1 and y0 <= y < y1:
                frame_pixels[x - x0, y - y0] = pixels[x, y]
        frame = bleed_edge_colors(tighten_alpha(frame), iterations=5)
        frames.append(FrameSource(image=frame, anchor=compute_body_anchor(frame)))

    return frames


def alpha_bbox(image: Image.Image) -> tuple[int, int, int, int] | None:
    return image.getchannel("A").getbbox()


def alpha_area_metric(image: Image.Image) -> float:
    alpha = np.array(image.convert("RGBA"))[:, :, 3]
    area = int(np.count_nonzero(alpha > 64))
    return math.sqrt(max(1, area))


def normalize_frames(frames: list[FrameSource]) -> list[Image.Image]:
    normalized: list[Image.Image] = []
    if not frames:
        return normalized

    metrics = [alpha_area_metric(frame.image) for frame in frames]
    target_metric = float(np.median(metrics))
    max_scaled_width_at_1x = max(frame.image.width * (target_metric / metric) for frame, metric in zip(frames, metrics))
    max_scaled_height_at_1x = max(frame.image.height * (target_metric / metric) for frame, metric in zip(frames, metrics))
    base_scale = min(
        (RUNTIME_FRAME_SIZE * 0.92) / max_scaled_width_at_1x,
        (RUNTIME_FRAME_SIZE * 0.92) / max_scaled_height_at_1x,
    )

    measured: list[tuple[FrameSource, int, int, float, float]] = []
    for frame, metric in zip(frames, metrics):
        frame_scale = base_scale * (target_metric / metric)
        width = max(1, round(frame.image.width * frame_scale))
        height = max(1, round(frame.image.height * frame_scale))
        anchor_x = frame.anchor[0] * frame_scale
        anchor_y = frame.anchor[1] * frame_scale
        measured.append((frame, width, height, anchor_x, anchor_y))

    margin = 8
    x_min = max(anchor_x for _, _, _, anchor_x, _ in measured) + margin
    x_max = min(RUNTIME_FRAME_SIZE - (width - anchor_x) - margin for _, width, _, anchor_x, _ in measured)
    y_min = max(anchor_y for _, _, _, _, anchor_y in measured) + margin
    y_max = min(RUNTIME_FRAME_SIZE - (height - anchor_y) - margin for _, _, height, _, anchor_y in measured)
    target_x = min(max(RUNTIME_FRAME_SIZE * 0.5, x_min), x_max)
    target_y = min(max(RUNTIME_FRAME_SIZE - margin, y_min), y_max)

    for frame, width, height, anchor_x, anchor_y in measured:
        resized = frame.image.resize((width, height), Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (RUNTIME_FRAME_SIZE, RUNTIME_FRAME_SIZE), (0, 0, 0, 0))
        offset = (round(target_x - anchor_x), round(target_y - anchor_y))
        canvas.alpha_composite(resized, offset)
        normalized.append(bleed_edge_colors(tighten_alpha(canvas), iterations=5))
    return normalized


def write_grid_sprite(status: str, frames: list[Image.Image]) -> tuple[int, int]:
    rows = math.ceil(len(frames) / SPRITE_COLUMNS)
    sprite = Image.new(
        "RGBA",
        (SPRITE_COLUMNS * RUNTIME_FRAME_SIZE, rows * RUNTIME_FRAME_SIZE),
        (0, 0, 0, 0),
    )
    for index, frame in enumerate(frames):
        x = (index % SPRITE_COLUMNS) * RUNTIME_FRAME_SIZE
        y = (index // SPRITE_COLUMNS) * RUNTIME_FRAME_SIZE
        sprite.alpha_composite(frame, (x, y))

    output = ASSET_DIR / f"mascot-{status}-motion.webp"
    sprite.save(output, "WEBP", quality=96, alpha_quality=100, method=6, exact=True)
    return SPRITE_COLUMNS, rows


def build_status(sheet: SequenceSheet) -> dict[str, object]:
    source_path = ASSET_DIR / sheet.source
    source = Image.open(source_path)
    if sheet.extraction == "components":
        cleaned = split_sheet_by_components(source, sheet.frames)
    else:
        cleaned = [clean_tile(tile) for tile in split_sheet(source, sheet.columns, sheet.rows, sheet.frames)]
    frames = normalize_frames(cleaned)
    columns, rows = write_grid_sprite(sheet.status, frames)
    print(f"{sheet.status}: {len(frames)} sequential frames from {sheet.columns}x{sheet.rows}")
    return {
        "columns": columns,
        "rows": rows,
        "totalFrames": len(frames),
        "patterns": [{"id": "sequential-loop", "start": 0, "length": len(frames)}],
    }


def write_manifest(statuses: dict[str, dict[str, object]]) -> None:
    manifest = {
        "fps": FPS,
        "frameSize": RUNTIME_FRAME_SIZE,
        "statuses": statuses,
    }
    (ASSET_DIR / "mascot-motion-manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    missing = [sheet.source for sheet in SEQUENCE_SHEETS if not (ASSET_DIR / sheet.source).exists()]
    if missing:
        raise SystemExit(f"Missing source sheet(s): {', '.join(missing)}")

    statuses = {sheet.status: build_status(sheet) for sheet in SEQUENCE_SHEETS}
    write_manifest(statuses)


if __name__ == "__main__":
    main()
