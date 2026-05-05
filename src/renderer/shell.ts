import { invoke } from "@tauri-apps/api/core";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type WidgetResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

export type WidgetWindowGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
};

export type WidgetWindowFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export async function hideWidget(): Promise<void> {
  try {
    await getCurrentWindow().hide();
  } catch {
    // Browser preview fallback.
  }
}

export async function minimizeWidget(): Promise<void> {
  try {
    await invoke("minimize_window");
  } catch {
    try {
      await getCurrentWindow().minimize();
    } catch {
      // Browser preview fallback.
    }
  }
}

export async function toggleMaximizeWidget(): Promise<boolean> {
  try {
    return await invoke<boolean>("toggle_maximize_window");
  } catch {
    try {
      await getCurrentWindow().toggleMaximize();
      return await getCurrentWindow().isMaximized();
    } catch {
      return false;
    }
  }
}

export async function closeWidget(): Promise<void> {
  try {
    await invoke("close_window");
  } catch {
    try {
      await getCurrentWindow().hide();
    } catch {
      window.close();
    }
  }
}

export async function togglePinned(): Promise<boolean> {
  try {
    return await invoke<boolean>("toggle_pin");
  } catch {
    return false;
  }
}

export async function startDragWidget(): Promise<void> {
  try {
    await getCurrentWindow().startDragging();
  } catch {
    // Browser preview fallback.
  }
}

export async function startResizeWidget(direction: WidgetResizeDirection): Promise<boolean> {
  try {
    await invoke("start_window_resize", { direction });
    return true;
  } catch {
    // Fall through to Tauri's portable resize API.
  }

  try {
    await getCurrentWindow().startResizeDragging(direction);
    return true;
  } catch {
    return false;
  }
}

export async function readWidgetWindowGeometry(): Promise<WidgetWindowGeometry | null> {
  try {
    const window = getCurrentWindow();
    const [position, size, scaleFactor] = await Promise.all([
      window.outerPosition(),
      window.outerSize(),
      window.scaleFactor()
    ]);
    return {
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
      scaleFactor
    };
  } catch {
    return null;
  }
}

export async function setWidgetWindowFrame(frame: WidgetWindowFrame): Promise<void> {
  const nextFrame = {
    x: Math.round(frame.x),
    y: Math.round(frame.y),
    width: Math.round(frame.width),
    height: Math.round(frame.height)
  };

  try {
    await invoke("set_window_frame", nextFrame);
  } catch {
    try {
      const window = getCurrentWindow();
      await window.setPosition(new PhysicalPosition(nextFrame.x, nextFrame.y));
      await window.setSize(new PhysicalSize(nextFrame.width, nextFrame.height));
    } catch {
      // Browser preview fallback.
    }
  }
}

export async function openExternalUrl(url: string): Promise<void> {
  try {
    await invoke("open_external_url", { url });
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export async function readAutostartEnabled(): Promise<boolean> {
  try {
    return await invoke<boolean>("get_autostart_enabled");
  } catch {
    return false;
  }
}

export async function setAutostartEnabled(enabled: boolean): Promise<boolean> {
  try {
    return await invoke<boolean>("set_autostart_enabled", { enabled });
  } catch {
    return false;
  }
}
