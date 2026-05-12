import { useState } from "react";
import type { ClientMessage } from "../../shared/protocol.js";
import type { CapabilityJobsUiState } from "../types";

type UseCapabilityJobsControllerInput = {
  activeSessionId: string | null;
  send(message: ClientMessage): boolean;
};

function createInitialCapabilityJobsState(): CapabilityJobsUiState {
  return {
    jobs: [],
    eventsByJobId: {},
    resourcesByJobId: {},
    lastUpdatedAt: null
  };
}

export function useCapabilityJobsController(input: UseCapabilityJobsControllerInput) {
  const [capabilityJobs, setCapabilityJobs] = useState<CapabilityJobsUiState>(createInitialCapabilityJobsState);

  function refreshCapabilityJobs() {
    input.send({ type: "capability.list", sessionId: input.activeSessionId ?? undefined });
  }

  function cancelCapabilityJob(jobId: string) {
    input.send({
      type: "capability.cancel",
      requestId: `capability-cancel-${jobId}`,
      cancel: { jobId, reason: "renderer_panel_cancel" }
    });
  }

  function approveCapabilityJob(jobId: string) {
    input.send({
      type: "capability.approve",
      requestId: `capability-approve-${jobId}`,
      jobId
    });
  }

  return {
    capabilityJobs,
    setCapabilityJobs,
    refreshCapabilityJobs,
    cancelCapabilityJob,
    approveCapabilityJob
  };
}
