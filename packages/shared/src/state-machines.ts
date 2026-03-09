// packages/shared/src/state-machines.ts
// Canonical state machines for Permit Intel MVP
// Every status transition MUST go through these helpers.

// ============================================================
// ENUMS
// ============================================================

export type PermitStatus =
  | "new"
  | "normalized"
  | "prequalified"
  | "shortlisted"
  | "rejected"
  | "archived";

export type ReportStatus =
  | "draft"
  | "queued"
  | "running"
  | "partial"
  | "completed"
  | "failed"
  | "superseded"
  | "archived";

export type StageAttemptStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "retrying"
  | "failed_retryable"
  | "failed_terminal"
  | "skipped";

export type ExportStatus =
  | "draft"
  | "rendering"
  | "ready"
  | "delivered"
  | "failed";

// ============================================================
// TRANSITION TABLES
// ============================================================

const PERMIT_TRANSITIONS: Record<PermitStatus, PermitStatus[]> = {
  new: ["normalized", "rejected"],
  normalized: ["prequalified", "rejected"],
  prequalified: ["shortlisted", "rejected"],
  shortlisted: ["archived"],
  rejected: ["archived"],
  archived: [],
};

const REPORT_TRANSITIONS: Record<ReportStatus, ReportStatus[]> = {
  draft: ["queued", "archived"],
  queued: ["running", "failed"],
  running: ["completed", "partial", "failed"],
  partial: ["queued", "archived"],
  completed: ["superseded", "archived"],
  failed: ["queued", "archived"],
  superseded: ["archived"],
  archived: [],
};

const STAGE_TRANSITIONS: Record<StageAttemptStatus, StageAttemptStatus[]> = {
  queued: ["running", "skipped"],
  running: ["succeeded", "retrying", "failed_retryable", "failed_terminal"],
  retrying: ["running"],
  succeeded: [],
  failed_retryable: ["retrying", "failed_terminal"],
  failed_terminal: [],
  skipped: [],
};

const EXPORT_TRANSITIONS: Record<ExportStatus, ExportStatus[]> = {
  draft: ["rendering", "failed"],
  rendering: ["ready", "failed"],
  ready: ["delivered", "failed"],
  delivered: [],
  failed: ["draft"],
};

// ============================================================
// TRANSITION VALIDATION
// ============================================================

export class InvalidTransitionError extends Error {
  constructor(
    public readonly machine: string,
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`[${machine}] Invalid transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

function assertTransition<T extends string>(
  machine: string,
  table: Record<T, T[]>,
  from: T,
  to: T,
): void {
  const allowed = table[from];
  if (!allowed || !allowed.includes(to)) {
    throw new InvalidTransitionError(machine, from, to);
  }
}

export function assertPermitTransition(
  from: PermitStatus,
  to: PermitStatus,
): void {
  assertTransition("permit", PERMIT_TRANSITIONS, from, to);
}

export function assertReportTransition(
  from: ReportStatus,
  to: ReportStatus,
): void {
  assertTransition("report", REPORT_TRANSITIONS, from, to);
}

export function assertStageTransition(
  from: StageAttemptStatus,
  to: StageAttemptStatus,
): void {
  assertTransition("stage", STAGE_TRANSITIONS, from, to);
}

export function assertExportTransition(
  from: ExportStatus,
  to: ExportStatus,
): void {
  assertTransition("export", EXPORT_TRANSITIONS, from, to);
}

// ============================================================
// QUERY HELPERS
// ============================================================

export function isTerminalStageStatus(s: StageAttemptStatus): boolean {
  return s === "succeeded" || s === "failed_terminal" || s === "skipped";
}

export function isTerminalReportStatus(s: ReportStatus): boolean {
  return (
    s === "completed" ||
    s === "failed" ||
    s === "superseded" ||
    s === "archived"
  );
}

export function isTerminalExportStatus(s: ExportStatus): boolean {
  return s === "delivered" || s === "failed";
}

export function canRetryStage(s: StageAttemptStatus): boolean {
  return s === "failed_retryable" || s === "retrying";
}

export function canRetryReport(s: ReportStatus): boolean {
  return s === "failed" || s === "partial";
}
