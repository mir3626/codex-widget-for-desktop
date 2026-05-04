import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export async function hideWidget(): Promise<void> {
  try {
    await getCurrentWindow().hide();
  } catch {
    // Browser preview fallback.
  }
}

export async function togglePinned(): Promise<boolean> {
  try {
    return await invoke<boolean>("toggle_pin");
  } catch {
    return false;
  }
}
