import { describe, expect, it } from "vitest";
import { findRunningExecution, isContinuableExecution, mergeExecutionIntoList, resolveExecutionSelection } from "../src/client/executionState";
import type { ExecutionSummary } from "../src/server/types";

describe("client execution state", () => {
  it("finds the running execution for the selected task", () => {
    const running = execution({ id: "run-1", taskId: "task-1", status: "running", startedAt: "2026-05-08T21:00:00.000Z" });
    const otherTask = execution({ id: "run-2", taskId: "task-2", status: "running", startedAt: "2026-05-08T22:00:00.000Z" });

    expect(findRunningExecution([otherTask, running], "task-1")).toBe(running);
  });

  it("merges streaming execution updates without losing list order", () => {
    const oldRun = execution({ id: "old", taskId: "task-1", status: "success", startedAt: "2026-05-08T20:00:00.000Z" });
    const liveRun = execution({ id: "live", taskId: "task-1", status: "running", startedAt: "2026-05-08T21:00:00.000Z", stdoutSize: 5 });
    const updatedLiveRun = { ...liveRun, stdoutSize: 12 };

    expect(mergeExecutionIntoList([liveRun, oldRun], updatedLiveRun)).toEqual([updatedLiveRun, oldRun]);
  });

  it("prefers a running execution when opening logs for a task", () => {
    const finished = execution({ id: "done", taskId: "task-1", status: "success", startedAt: "2026-05-08T20:00:00.000Z" });
    const running = execution({ id: "live", taskId: "task-1", status: "running", startedAt: "2026-05-08T21:00:00.000Z" });

    expect(resolveExecutionSelection({ currentId: "done", executions: [running, finished], taskId: "task-1", preferRunning: true })).toBe(
      "live"
    );
  });

  it("allows continuing stale or failed executions when a Codex session id is known", () => {
    const stale = execution({
      status: "stale",
      resumeSessionId: "019e0dc0-bc6d-7c32-8520-2f1130559c89"
    });
    const failedWithoutSession = execution({ status: "failed", resumeSessionId: null });

    expect(isContinuableExecution(stale)).toBe(true);
    expect(isContinuableExecution(failedWithoutSession)).toBe(false);
  });
});

function execution(overrides: Partial<ExecutionSummary>): ExecutionSummary {
  return {
    id: "execution-id",
    taskId: "task-id",
    taskTitle: "Task",
    trigger: "manual",
    status: "success",
    startedAt: "2026-05-08T20:00:00.000Z",
    finishedAt: "2026-05-08T20:01:00.000Z",
    lastOutputAt: "2026-05-08T20:00:30.000Z",
    exitCode: 0,
    stdoutSize: 0,
    stderrSize: 0,
    command: ["codex", "exec"],
    cwd: "/tmp/codex-routines-fixture",
    prompt: "Run",
    error: null,
    processId: null,
    resumeSessionId: null,
    resumedFromExecutionId: null,
    staleAt: null,
    staleReason: null,
    ...overrides
  };
}
