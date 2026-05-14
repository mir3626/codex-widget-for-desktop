import type {
  CapabilityDagNodeSummary,
  CapabilityDagRunSummary,
  CapabilityStartInput
} from "../../shared/protocol.js";
import type { CapabilityRuntime } from "../capability-runtime/index.js";
import type { StorageService } from "../storage/storage.js";

export type CapabilityDagPlanNode = {
  id: string;
  kind: CapabilityDagNodeSummary["kind"];
  capability?: CapabilityStartInput;
  dependsOn?: string[];
  confidenceGate?: number;
  input?: unknown;
};

export class CapabilityDagRuntime {
  constructor(
    private readonly storage: StorageService,
    private readonly capabilityRuntime: CapabilityRuntime
  ) {}

  createRun(input: {
    id?: string;
    evalRunId?: string;
    sessionId?: string;
    goal?: string;
    metadata?: Record<string, unknown>;
    nodes: CapabilityDagPlanNode[];
  }): CapabilityDagRunSummary {
    const run = this.storage.createCapabilityDagRun({
      id: input.id,
      evalRunId: input.evalRunId,
      sessionId: input.sessionId,
      goal: input.goal,
      metadata: {
        ...input.metadata,
        nodeCount: input.nodes.length
      },
      status: "pending"
    });
    for (const node of input.nodes) {
      this.storage.upsertCapabilityDagNode({
        id: node.id,
        dagRunId: run.id,
        kind: node.kind,
        status: (node.dependsOn?.length ?? 0) > 0 ? "pending" : "ready",
        capabilityKind: node.capability?.kind,
        priority: node.capability?.priority,
        requestedBy: node.capability?.requestedBy,
        dependsOn: node.dependsOn ?? [],
        confidenceGate: node.confidenceGate,
        input: node.input ?? node.capability?.input ?? {}
      });
    }
    return run;
  }

  async runReadyNodes(dagRunId: string): Promise<CapabilityDagNodeSummary[]> {
    let nodes = this.storage.listCapabilityDagNodes(dagRunId);
    const started: CapabilityDagNodeSummary[] = [];
    const completedIds = new Set(nodes.filter((node) => node.status === "completed" || node.status === "skipped").map((node) => node.id));
    for (const node of nodes) {
      if (node.status !== "ready" && node.status !== "pending") {
        continue;
      }
      if (!node.dependsOn.every((dependency) => completedIds.has(dependency))) {
        continue;
      }
      if (!node.capabilityKind) {
        const now = new Date().toISOString();
        const completed = this.storage.upsertCapabilityDagNode({
          ...node,
          status: "completed",
          output: { ok: true, mode: "local_dag_node" },
          startedAt: node.startedAt ?? now,
          completedAt: now,
          elapsedMs: node.startedAt ? Math.max(0, Date.parse(now) - Date.parse(node.startedAt)) : 0
        });
        completedIds.add(completed.id);
        started.push(completed);
        continue;
      }
      const running = this.storage.upsertCapabilityDagNode({
        ...node,
        status: "running",
        startedAt: new Date().toISOString()
      });
      const job = await this.capabilityRuntime.enqueue({
        kind: node.capabilityKind,
        priority: node.priority,
        requestedBy: node.requestedBy,
        sessionId: this.storage.readCapabilityDagRun(dagRunId)?.sessionId,
        input: {
          ...(node.input && typeof node.input === "object" ? node.input as Record<string, unknown> : { value: node.input }),
          dagRunId,
          dagNodeId: node.id,
          evalRunId: this.storage.readCapabilityDagRun(dagRunId)?.evalRunId
        },
        timeoutMs: readTimeoutMs(node.input)
      });
      const latestNode = this.storage.readCapabilityDagNode(node.id) ?? running;
      started.push(this.storage.upsertCapabilityDagNode({
        ...latestNode,
        capabilityJobId: job.id,
        status: isFinalDagNodeStatus(latestNode.status) ? latestNode.status : "running",
        startedAt: latestNode.startedAt ?? running.startedAt
      }));
    }
    nodes = this.storage.listCapabilityDagNodes(dagRunId);
    const finalStatus = nodes.some((node) => node.status === "failed" || node.status === "cancelled")
      ? "failed"
      : nodes.every((node) => node.status === "completed" || node.status === "skipped")
        ? "completed"
        : "running";
    this.storage.updateCapabilityDagRun({
      id: dagRunId,
      status: finalStatus,
      completedAt: finalStatus === "completed" || finalStatus === "failed" ? new Date().toISOString() : undefined
    });
    return started;
  }
}

function readTimeoutMs(input: unknown): number | undefined {
  const record = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return typeof record.timeoutMs === "number" ? record.timeoutMs : undefined;
}

function isFinalDagNodeStatus(status: CapabilityDagNodeSummary["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "skipped";
}
