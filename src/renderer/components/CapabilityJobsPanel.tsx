import { Check, Clipboard, RefreshCw, Square, Workflow } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CapabilityJobStatus } from "../../shared/protocol.js";
import type { CapabilityJobsUiState } from "../types";
import { formatActivityTime } from "../utils/format";

type CapabilityJobDetail = {
  ok: boolean;
  job?: unknown;
  resources?: unknown[];
  locks?: unknown[];
  diagnostics?: unknown;
  error?: string;
};

type CapabilityJobsPanelProps = {
  state: CapabilityJobsUiState;
  daemonPort: string;
  onApprove: (jobId: string) => void;
  onCancel: (jobId: string) => void;
  onRefresh: () => void;
};

export function CapabilityJobsPanel({
  state,
  daemonPort,
  onApprove,
  onCancel,
  onRefresh
}: CapabilityJobsPanelProps) {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CapabilityJobDetail | null>(null);
  const [detailStatus, setDetailStatus] = useState<"idle" | "loading" | "failed">("idle");
  const jobs = useMemo(() => state.jobs.slice(0, 8), [state.jobs]);
  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? jobs[0] ?? null;
  const selectedEvents = selectedJob ? state.eventsByJobId[selectedJob.id] ?? [] : [];
  const selectedResources = selectedJob ? state.resourcesByJobId[selectedJob.id] ?? [] : [];

  useEffect(() => {
    if (!selectedJobId && jobs[0]) {
      setSelectedJobId(jobs[0].id);
    }
    if (selectedJobId && !jobs.some((job) => job.id === selectedJobId)) {
      setSelectedJobId(jobs[0]?.id ?? null);
    }
  }, [jobs, selectedJobId]);

  useEffect(() => {
    if (!selectedJob) {
      setDetail(null);
      return undefined;
    }
    let cancelled = false;
    setDetailStatus("loading");
    fetch(`http://127.0.0.1:${daemonPort}/capabilities/jobs/${encodeURIComponent(selectedJob.id)}`)
      .then(async (response) => {
        const payload = await response.json() as CapabilityJobDetail;
        if (!cancelled) {
          setDetail(payload);
          setDetailStatus(response.ok ? "idle" : "failed");
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setDetail({ ok: false, error: error instanceof Error ? error.message : String(error) });
          setDetailStatus("failed");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [daemonPort, selectedJob?.id, selectedJob?.updatedAt]);

  return (
    <section className="capability-jobs-panel" aria-label="Capability Jobs">
      <div className="capability-jobs-head">
        <div>
          <Workflow size={12} />
          <strong>Capability Jobs</strong>
          <span>{jobs.length ? `${jobs.length} tracked` : "empty"}</span>
        </div>
        <div className="capability-jobs-actions">
          <button type="button" aria-label="Refresh capability jobs" data-tooltip="Refresh capability jobs" onClick={onRefresh}>
            <RefreshCw size={12} />
          </button>
          <button
            type="button"
            aria-label="Copy capability job JSON"
            data-tooltip="Copy selected job JSON"
            disabled={!selectedJob}
            onClick={() => copyDetail(detail ?? selectedJob)}
          >
            <Clipboard size={12} />
          </button>
        </div>
      </div>
      {jobs.length ? (
        <>
          <div className="capability-job-list">
            {jobs.map((job) => (
              <button
                type="button"
                key={job.id}
                className={selectedJob?.id === job.id ? "capability-job-row selected" : "capability-job-row"}
                onClick={() => setSelectedJobId(job.id)}
              >
                <span className={`capability-status ${statusTone(job.status)}`}>{job.status}</span>
                <strong>{job.kind}</strong>
                <small>{shortId(job.id)}</small>
              </button>
            ))}
          </div>
          {selectedJob ? (
            <div className="capability-job-detail">
              <div className="capability-job-detail-head">
                <div>
                  <strong>{selectedJob.kind}</strong>
                  <span>{shortId(selectedJob.transactionId)}</span>
                </div>
                <div className="capability-jobs-actions">
                  <button
                    type="button"
                    aria-label="Approve capability job"
                    data-tooltip="Approve"
                    disabled={selectedJob.status !== "awaiting_approval"}
                    onClick={() => onApprove(selectedJob.id)}
                  >
                    <Check size={12} />
                  </button>
                  <button
                    type="button"
                    aria-label="Cancel capability job"
                    data-tooltip="Cancel"
                    disabled={!canCancel(selectedJob.status)}
                    onClick={() => onCancel(selectedJob.id)}
                  >
                    <Square size={12} />
                  </button>
                </div>
              </div>
              <dl className="capability-job-metrics">
                <div>
                  <dt>Priority</dt>
                  <dd>{selectedJob.priority}</dd>
                </div>
                <div>
                  <dt>Requested</dt>
                  <dd>{selectedJob.requestedBy}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>{formatActivityTime(selectedJob.updatedAt)}</dd>
                </div>
              </dl>
              {selectedJob.lastError ? <p className="capability-job-error">{selectedJob.lastError}</p> : null}
              {selectedEvents.length || selectedResources.length ? (
                <div className="capability-job-timeline">
                  {selectedEvents.slice(0, 5).map((event) => (
                    <div key={event.id} className="capability-job-event">
                      <span>{formatActivityTime(event.createdAt)}</span>
                      <strong>{event.summary}</strong>
                      <small>{event.phase ?? event.status}</small>
                    </div>
                  ))}
                  {selectedResources.slice(0, 3).map((resource) => (
                    <div key={resource.id} className="capability-job-event resource">
                      <span>{resource.mime}</span>
                      <strong>{resource.role}</strong>
                      <small>{shortId(resource.resourceId)}</small>
                    </div>
                  ))}
                </div>
              ) : null}
              <details className="capability-job-json">
                <summary>{detailStatus === "loading" ? "Loading detail" : detailStatus === "failed" ? "Detail failed" : "Detail JSON"}</summary>
                <pre>{JSON.stringify(detail ?? selectedJob, null, 2).slice(0, 2400)}</pre>
              </details>
            </div>
          ) : null}
        </>
      ) : (
        <p>No capability jobs yet</p>
      )}
    </section>
  );
}

function canCancel(status: CapabilityJobStatus): boolean {
  return status === "queued" || status === "scheduled" || status === "awaiting_approval" || status === "running";
}

function statusTone(status: CapabilityJobStatus): string {
  if (status === "completed") return "ok";
  if (status === "failed" || status === "expired") return "error";
  if (status === "cancelled" || status === "cancelling") return "warn";
  return "active";
}

function shortId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function copyDetail(value: unknown) {
  void navigator.clipboard?.writeText(JSON.stringify(value, null, 2)).catch(() => undefined);
}
