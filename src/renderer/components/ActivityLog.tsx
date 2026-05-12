import { Activity, Eye, FileText, RotateCw } from "lucide-react";
import { useRef } from "react";
import { createPortal } from "react-dom";
import type { ActivityLogEntry, LedgerSnapshot, ProviderSnapshotSummary } from "../../shared/protocol.js";
import { useFloatingSurface } from "../hooks/useFloatingSurface";
import type { LogLine } from "../types";
import type { CapabilityJobsUiState } from "../types";
import { formatActivityTime } from "../utils/format";
import { CapabilityJobsPanel } from "./CapabilityJobsPanel";
import { ProviderSnapshotRow } from "./ProviderSnapshotRow";

type ActivityLogProps = {
  visibleActivities: ActivityLogEntry[];
  fallbackLines: LogLine[];
  showDetails: boolean;
  activityBadgeCount: number;
  ledger: LedgerSnapshot | null;
  capabilityJobs: CapabilityJobsUiState;
  daemonPort: string;
  providerSnapshots: ProviderSnapshotSummary[];
  onApproveCapabilityJob: (jobId: string) => void;
  onCancelCapabilityJob: (jobId: string) => void;
  onRefreshCapabilityJobs: () => void;
  onToggleDetails: () => void;
  onRefresh: () => void;
};

export function ActivityLog({
  visibleActivities,
  fallbackLines,
  showDetails,
  activityBadgeCount,
  ledger,
  capabilityJobs,
  daemonPort,
  providerSnapshots,
  onApproveCapabilityJob,
  onCancelCapabilityJob,
  onRefreshCapabilityJobs,
  onToggleDetails,
  onRefresh
}: ActivityLogProps) {
  const detailsButtonRef = useRef<HTMLButtonElement | null>(null);
  const floating = useFloatingSurface(showDetails, detailsButtonRef, { preferred: "top-end", offset: 6, margin: 8 });

  return (
    <div className="log-list" aria-label="Activity">
      <div className="log-statusbar">
        <div className="log-heading">
          <Activity size={12} />
          <span>Activity</span>
        </div>
        <button
          ref={detailsButtonRef}
          type="button"
          className={showDetails ? "activity-detail-button active" : "activity-detail-button"}
          data-tooltip="Activity details"
          aria-label="Activity details"
          aria-pressed={showDetails}
          onClick={onToggleDetails}
        >
          <FileText size={12} />
          {activityBadgeCount > 0 ? <span>{activityBadgeCount}</span> : null}
        </button>
      </div>
      <div className="log-lines">
        {visibleActivities.length > 0 ? (
          visibleActivities.map((activity) => (
            <div
              key={activity.id}
              className={`log-line ${activity.level === "error" ? "error" : activity.category === "tool" || activity.category === "artifact" ? "tool" : "muted"}`}
            >
              {activity.summary}
            </div>
          ))
        ) : (
          fallbackLines.slice(0, 1).map((line) => (
            <div key={line.id} className={`log-line ${line.tone}`}>
              {line.text}
            </div>
          ))
        )}
      </div>
      {showDetails
        ? createPortal(
            <div
              ref={floating.surfaceRef}
              className={`activity-popover floating-surface placement-${floating.placement}`}
              style={floating.floatingStyle}
              role="dialog"
              aria-label="Activity details"
            >
              <div className="activity-popover-head">
                <strong>Activity</strong>
                <button type="button" data-tooltip="Refresh activity" aria-label="Refresh activity" onClick={onRefresh}>
                  <RotateCw size={12} />
                </button>
              </div>
              <CapabilityJobsPanel
                state={capabilityJobs}
                daemonPort={daemonPort}
                onApprove={onApproveCapabilityJob}
                onCancel={onCancelCapabilityJob}
                onRefresh={onRefreshCapabilityJobs}
              />
              {(ledger?.activities ?? []).slice(0, 12).map((activity) => (
                <div key={activity.id} className={`activity-detail-row ${activity.level}`}>
                  <span>{formatActivityTime(activity.createdAt)}</span>
                  <strong>{activity.summary}</strong>
                  <small>{activity.category}</small>
                </div>
              ))}
              {providerSnapshots.length > 0 ? (
                <div className="provider-history-section">
                  <div className="provider-history-title">
                    <Eye size={12} />
                    <strong>Provider history</strong>
                  </div>
                  {providerSnapshots.slice(0, 8).map((snapshot) => (
                    <ProviderSnapshotRow key={snapshot.id} snapshot={snapshot} />
                  ))}
                </div>
              ) : null}
              {ledger && ledger.activities.length === 0 && providerSnapshots.length === 0 ? <p>No activity yet</p> : null}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
