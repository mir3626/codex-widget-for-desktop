import { z } from 'zod';
import { IsoDateTimeSchema } from './datetime.js';

export const SidecarNameSchema = z.enum(['diff-reviewer']);
export const SidecarProviderSchema = z.enum(['claude', 'codex', 'mock']);
export const SidecarEffortSchema = z.enum(['high', 'xhigh']);
export const SidecarStatusSchema = z.enum(['pass', 'advisory', 'fail', 'error', 'unavailable']);
export const SidecarReviewerStatusSchema = z.enum(['pass', 'advisory', 'fail']);
export const SidecarSeveritySchema = z.enum(['high', 'medium', 'low']);
export const SidecarConfidenceSchema = z.enum(['high', 'medium', 'low']);

export const SidecarCoverageSchema = z.object({
  inputFilesSeen: z.number().int().min(0),
  diffBytesSeen: z.number().int().min(0),
  truncated: z.boolean(),
});

export const SidecarFindingSchema = z.object({
  severity: SidecarSeveritySchema,
  confidence: SidecarConfidenceSchema,
  file: z.string().min(1),
  line: z.number().int().positive().optional(),
  message: z.string().min(1).max(1200),
  recommendation: z.string().min(1).max(1200),
});

export const SidecarInputPacketSchema = z.object({
  schemaVersion: z.literal(1),
  sidecar: SidecarNameSchema,
  sprintId: z.string().min(1),
  gitSha: z.string().min(1),
  inputHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  promptSummary: z.string().max(12000).optional(),
  diff: z.string(),
  changedFiles: z.array(z.string().min(1)).max(300),
  checklist: z.array(z.string().min(1).max(500)).max(50),
  relevantLogs: z.array(z.string().min(1).max(4000)).max(20),
  evidenceRefs: z.array(z.string().min(1).max(500)).max(50),
  coverage: SidecarCoverageSchema,
});

export const SidecarReviewerOutputSchema = z.object({
  schemaVersion: z.literal(1),
  sidecar: SidecarNameSchema,
  status: SidecarReviewerStatusSchema,
  summary: z.string().min(1).max(1000),
  findings: z.array(SidecarFindingSchema).max(20),
  limitations: z.array(z.string().min(1).max(500)).max(10),
  coverage: SidecarCoverageSchema,
});

export const SidecarArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  sidecar: SidecarNameSchema,
  status: SidecarStatusSchema,
  summary: z.string().min(1).max(1000),
  findings: z.array(SidecarFindingSchema).max(20),
  limitations: z.array(z.string().min(1).max(500)).max(10),
  coverage: SidecarCoverageSchema,
  provider: SidecarProviderSchema,
  model: z.string().min(1),
  effort: SidecarEffortSchema,
  sprintId: z.string().min(1),
  gitSha: z.string().min(1),
  inputHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  createdAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema,
  durationMs: z.number().int().min(0),
  exitCode: z.number().int().nullable(),
  stderrPreview: z.string().max(4000).optional(),
  rawPreview: z.string().max(4000).optional(),
  error: z.string().max(1000).optional(),
});

export type SidecarName = z.infer<typeof SidecarNameSchema>;
export type SidecarProvider = z.infer<typeof SidecarProviderSchema>;
export type SidecarEffort = z.infer<typeof SidecarEffortSchema>;
export type SidecarInputPacket = z.infer<typeof SidecarInputPacketSchema>;
export type SidecarReviewerOutput = z.infer<typeof SidecarReviewerOutputSchema>;
export type SidecarArtifact = z.infer<typeof SidecarArtifactSchema>;
