import { Check } from "lucide-react";
import type { ToastNotice } from "../../types";

type WidgetToastProps = {
  notice: ToastNotice | null;
};

export function WidgetToast({ notice }: WidgetToastProps) {
  return notice ? (
    <div key={notice.id} className="widget-toast" role="status" aria-live="polite">
      <Check size={13} />
      <span>{notice.text}</span>
    </div>
  ) : null;
}
