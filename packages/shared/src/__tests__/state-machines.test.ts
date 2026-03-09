// packages/shared/src/__tests__/state-machines.test.ts
import { describe, it, expect } from "vitest";
import {
  assertPermitTransition,
  assertReportTransition,
  assertStageTransition,
  assertExportTransition,
  InvalidTransitionError,
  isTerminalStageStatus,
  isTerminalReportStatus,
  canRetryStage,
  canRetryReport,
} from "../state-machines.js";

describe("permit state machine", () => {
  it("allows valid transitions", () => {
    expect(() => assertPermitTransition("new", "normalized")).not.toThrow();
    expect(() => assertPermitTransition("normalized", "prequalified")).not.toThrow();
    expect(() => assertPermitTransition("prequalified", "shortlisted")).not.toThrow();
    expect(() => assertPermitTransition("new", "rejected")).not.toThrow();
    expect(() => assertPermitTransition("shortlisted", "archived")).not.toThrow();
  });

  it("rejects invalid transitions", () => {
    expect(() => assertPermitTransition("new", "shortlisted")).toThrow(InvalidTransitionError);
    expect(() => assertPermitTransition("archived", "new")).toThrow(InvalidTransitionError);
    expect(() => assertPermitTransition("rejected", "shortlisted")).toThrow(InvalidTransitionError);
    expect(() => assertPermitTransition("shortlisted", "new")).toThrow(InvalidTransitionError);
  });

  it("error contains machine and state info", () => {
    try {
      assertPermitTransition("new", "shortlisted");
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidTransitionError);
      const err = e as InvalidTransitionError;
      expect(err.machine).toBe("permit");
      expect(err.from).toBe("new");
      expect(err.to).toBe("shortlisted");
    }
  });
});

describe("report state machine", () => {
  it("allows valid transitions", () => {
    expect(() => assertReportTransition("draft", "queued")).not.toThrow();
    expect(() => assertReportTransition("queued", "running")).not.toThrow();
    expect(() => assertReportTransition("running", "completed")).not.toThrow();
    expect(() => assertReportTransition("running", "partial")).not.toThrow();
    expect(() => assertReportTransition("running", "failed")).not.toThrow();
    expect(() => assertReportTransition("partial", "queued")).not.toThrow();
    expect(() => assertReportTransition("failed", "queued")).not.toThrow();
  });

  it("rejects invalid transitions", () => {
    expect(() => assertReportTransition("completed", "queued")).toThrow(InvalidTransitionError);
    expect(() => assertReportTransition("draft", "completed")).toThrow(InvalidTransitionError);
    expect(() => assertReportTransition("archived", "running")).toThrow(InvalidTransitionError);
  });

  it("terminal statuses are correct", () => {
    expect(isTerminalReportStatus("completed")).toBe(true);
    expect(isTerminalReportStatus("failed")).toBe(true);
    expect(isTerminalReportStatus("superseded")).toBe(true);
    expect(isTerminalReportStatus("archived")).toBe(true);
    expect(isTerminalReportStatus("running")).toBe(false);
    expect(isTerminalReportStatus("partial")).toBe(false);
  });

  it("retryable report statuses are correct", () => {
    expect(canRetryReport("failed")).toBe(true);
    expect(canRetryReport("partial")).toBe(true);
    expect(canRetryReport("completed")).toBe(false);
    expect(canRetryReport("running")).toBe(false);
  });
});

describe("stage attempt state machine", () => {
  it("allows valid transitions", () => {
    expect(() => assertStageTransition("queued", "running")).not.toThrow();
    expect(() => assertStageTransition("running", "succeeded")).not.toThrow();
    expect(() => assertStageTransition("running", "retrying")).not.toThrow();
    expect(() => assertStageTransition("retrying", "running")).not.toThrow();
    expect(() => assertStageTransition("running", "failed_terminal")).not.toThrow();
    expect(() => assertStageTransition("queued", "skipped")).not.toThrow();
  });

  it("rejects invalid transitions", () => {
    expect(() => assertStageTransition("succeeded", "running")).toThrow(InvalidTransitionError);
    expect(() => assertStageTransition("failed_terminal", "running")).toThrow(InvalidTransitionError);
    expect(() => assertStageTransition("skipped", "running")).toThrow(InvalidTransitionError);
  });

  it("terminal stage statuses are correct", () => {
    expect(isTerminalStageStatus("succeeded")).toBe(true);
    expect(isTerminalStageStatus("failed_terminal")).toBe(true);
    expect(isTerminalStageStatus("skipped")).toBe(true);
    expect(isTerminalStageStatus("running")).toBe(false);
    expect(isTerminalStageStatus("retrying")).toBe(false);
    expect(isTerminalStageStatus("failed_retryable")).toBe(false);
  });

  it("retryable stage statuses are correct", () => {
    expect(canRetryStage("failed_retryable")).toBe(true);
    expect(canRetryStage("retrying")).toBe(true);
    expect(canRetryStage("succeeded")).toBe(false);
    expect(canRetryStage("failed_terminal")).toBe(false);
  });
});

describe("export state machine", () => {
  it("allows valid transitions", () => {
    expect(() => assertExportTransition("draft", "rendering")).not.toThrow();
    expect(() => assertExportTransition("rendering", "ready")).not.toThrow();
    expect(() => assertExportTransition("ready", "delivered")).not.toThrow();
    expect(() => assertExportTransition("draft", "failed")).not.toThrow();
    expect(() => assertExportTransition("failed", "draft")).not.toThrow();
  });

  it("rejects invalid transitions", () => {
    expect(() => assertExportTransition("delivered", "rendering")).toThrow(InvalidTransitionError);
    expect(() => assertExportTransition("ready", "draft")).toThrow(InvalidTransitionError);
  });
});
