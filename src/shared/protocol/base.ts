export type WidgetMode = "agent" | "browser" | "screen" | "terminal";

export type ScreenCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BranchContextMessage = {
  role: "user" | "assistant";
  text: string;
};

export type CodexUserInput =
  | {
      type: "text";
      text: string;
      text_elements: [];
    }
  | {
      type: "image";
      url: string;
    }
  | {
      type: "localImage";
      path: string;
    };
