declare global {
  interface Window {
    widgetShell: {
      hide: () => Promise<void>;
      quit: () => Promise<void>;
      togglePin: () => Promise<boolean>;
    };
  }
}

export {};
