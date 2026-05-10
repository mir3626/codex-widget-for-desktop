import { useEffect, useRef, useState } from "react";
import {
  minimizeWidget,
  readAutostartEnabled,
  setAutostartEnabled,
  toggleMaximizeWidget,
  togglePinned
} from "../shell";
import type { LogLine, ToastNotice } from "../types";
import { clampOpacity, readStoredOpacity } from "../utils/storage";

type UseWidgetShellControllerInput = {
  appendLog(text: string, tone: LogLine["tone"]): void;
};

export function useWidgetShellController(input: UseWidgetShellControllerInput) {
  const [autostartEnabled, setAutostartEnabledState] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [opacity, setOpacity] = useState(() => readStoredOpacity());
  const [pinned, setPinned] = useState(true);
  const [showOpacityValue, setShowOpacityValue] = useState(false);
  const [toastNotice, setToastNotice] = useState<ToastNotice | null>(null);
  const opacityValueTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    void readAutostartEnabled().then(setAutostartEnabledState);
  }, []);

  function togglePinState() {
    void togglePinned().then((nextPinned) => {
      setPinned(nextPinned);
      input.appendLog(nextPinned ? "Pinned" : "Unpinned", "tool");
    });
  }

  function minimize() {
    void minimizeWidget().then(() => input.appendLog("Minimized", "muted"));
  }

  function toggleMaximize() {
    void toggleMaximizeWidget().then((nextMaximized) => {
      setMaximized(nextMaximized);
      input.appendLog(nextMaximized ? "Maximized" : "Restored", "muted");
    });
  }

  function updateOpacity(value: string) {
    const nextOpacity = clampOpacity(Number(value));
    setOpacity(nextOpacity);
    localStorage.setItem("codex-widget-opacity", String(nextOpacity));
    revealOpacityValue();
  }

  function showToast(text: string) {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToastNotice({ id: Date.now(), text });
    toastTimerRef.current = window.setTimeout(() => {
      setToastNotice(null);
      toastTimerRef.current = null;
    }, 1900);
  }

  function revealOpacityValue() {
    if (opacityValueTimerRef.current !== null) {
      window.clearTimeout(opacityValueTimerRef.current);
    }
    setShowOpacityValue(true);
    opacityValueTimerRef.current = window.setTimeout(() => {
      setShowOpacityValue(false);
      opacityValueTimerRef.current = null;
    }, 850);
  }

  function hideOpacityValueSoon() {
    if (opacityValueTimerRef.current !== null) {
      window.clearTimeout(opacityValueTimerRef.current);
    }
    opacityValueTimerRef.current = window.setTimeout(() => {
      setShowOpacityValue(false);
      opacityValueTimerRef.current = null;
    }, 220);
  }

  function updateAutostart(enabled: boolean) {
    setAutostartEnabledState(enabled);
    void setAutostartEnabled(enabled)
      .then((nextEnabled) => {
        setAutostartEnabledState(nextEnabled);
        input.appendLog(nextEnabled ? "start at login enabled" : "start at login disabled", "tool");
      })
      .catch(() => {
        setAutostartEnabledState(!enabled);
        input.appendLog("start at login unavailable", "error");
      });
  }

  function cleanupShellEffects() {
    if (opacityValueTimerRef.current !== null) {
      window.clearTimeout(opacityValueTimerRef.current);
    }
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
  }

  return {
    autostartEnabled,
    maximized,
    opacity,
    pinned,
    showOpacityValue,
    toastNotice,
    cleanupShellEffects,
    hideOpacityValueSoon,
    minimize,
    revealOpacityValue,
    showToast,
    toggleMaximize,
    togglePinState,
    updateAutostart,
    updateOpacity
  };
}
