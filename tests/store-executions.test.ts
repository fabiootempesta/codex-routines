import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonStore } from "../src/server/store";
import type { Task } from "../src/server/types";

let tempDir: string;
let store: JsonStore;

describe("execution recovery state", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "codex-routines-store-"));
    store = new JsonStore(path.join(tempDir, "db.json"));
    await store.init();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("tracks output activity and extracts the Codex session id from stderr", async () => {
    const task = await store.createTask(taskInput());
    const execution = await store.createExecution({
      task,
      trigger: "manual",
      command: ["codex", "exec"]
    });

    const originalLastOutputAt = execution.lastOutputAt;
    await new Promise((resolve) => setTimeout(resolve, 2));
    await store.appendExecutionOutput(
      execution.id,
      "stderr",
      "workdir: /tmp\nsession id: 019e0dc0-bc6d-7c32-8520-2f1130559c89\n"
    );

    const updated = store.getExecution(execution.id);
    expect(updated?.lastOutputAt).not.toBe(originalLastOutputAt);
    expect(updated?.resumeSessionId).toBe("019e0dc0-bc6d-7c32-8520-2f1130559c89");
  });

  it("marks untracked running executions as stale instead of leaving them running forever", async () => {
    const task = await store.createTask(taskInput());
    const execution = await store.createExecution({
      task,
      trigger: "manual",
      command: ["codex", "exec"]
    });

    await store.appendExecutionOutput(
      execution.id,
      "stderr",
      "session id: 019e0dc0-bc6d-7c32-8520-2f1130559c89\n"
    );
    const stale = await store.markUntrackedRunningExecutions(new Set(), new Date("2026-05-09T18:30:00.000Z"));

    expect(stale.map((item) => item.id)).toEqual([execution.id]);
    const updated = store.getExecution(execution.id);
    expect(updated?.status).toBe("stale");
    expect(updated?.staleAt).toBe("2026-05-09T18:30:00.000Z");
    expect(updated?.error).toContain("Orphaned");
  });

  it("does not mark executions that are still tracked by the scheduler", async () => {
    const task = await store.createTask(taskInput());
    const execution = await store.createExecution({
      task,
      trigger: "manual",
      command: ["codex", "exec"]
    });

    const stale = await store.markUntrackedRunningExecutions(new Set([execution.id]), new Date("2026-05-09T18:30:00.000Z"));

    expect(stale).toEqual([]);
    expect(store.getExecution(execution.id)?.status).toBe("running");
  });

  it("uses a pre-generated execution id so the scheduler can register it before the DB write resolves", async () => {
    const task = await store.createTask(taskInput());
    const reservedId = "019e131e-b650-7e10-939c-cd95a88fd5bc";

    const execution = await store.createExecution({
      id: reservedId,
      task,
      trigger: "manual",
      command: ["codex", "exec"]
    });

    expect(execution.id).toBe(reservedId);
    expect(store.getExecution(reservedId)?.id).toBe(reservedId);
  });

  it("emits summaries that omit raw output and report stream sizes", async () => {
    const task = await store.createTask(taskInput());
    const execution = await store.createExecution({
      task,
      trigger: "manual",
      command: ["codex", "exec"]
    });
    await store.appendExecutionOutput(execution.id, "stdout", "hello world");
    await store.appendExecutionOutput(execution.id, "stderr", "warn 1\nwarn 2");

    const summary = store.getExecutionSummary(execution.id);
    expect(summary).not.toBeNull();
    expect(summary).not.toHaveProperty("stdout");
    expect(summary).not.toHaveProperty("stderr");
    expect(summary?.stdoutSize).toBe("hello world".length);
    expect(summary?.stderrSize).toBe("warn 1\nwarn 2".length);
  });

  it("returns the tail of an output stream when no range is provided", async () => {
    const task = await store.createTask(taskInput());
    const execution = await store.createExecution({
      task,
      trigger: "manual",
      command: ["codex", "exec"]
    });
    await store.appendExecutionOutput(execution.id, "stdout", "0123456789ABCDEFGHIJ");

    const tail = store.getExecutionOutput(execution.id, "stdout", { tail: 5 });

    expect(tail).toEqual({
      stream: "stdout",
      from: 15,
      to: 20,
      totalSize: 20,
      content: "FGHIJ"
    });
  });

  it("returns the requested byte range when from and to are given", async () => {
    const task = await store.createTask(taskInput());
    const execution = await store.createExecution({
      task,
      trigger: "manual",
      command: ["codex", "exec"]
    });
    await store.appendExecutionOutput(execution.id, "stderr", "0123456789ABCDEFGHIJ");

    const range = store.getExecutionOutput(execution.id, "stderr", { from: 4, to: 10 });

    expect(range?.content).toBe("456789");
    expect(range?.from).toBe(4);
    expect(range?.to).toBe(10);
    expect(range?.totalSize).toBe(20);
  });

  it("returns bytes appended after a known offset for incremental polling", async () => {
    const task = await store.createTask(taskInput());
    const execution = await store.createExecution({
      task,
      trigger: "manual",
      command: ["codex", "exec"]
    });
    await store.appendExecutionOutput(execution.id, "stdout", "first");
    await store.appendExecutionOutput(execution.id, "stdout", "-then-more");

    const incremental = store.getExecutionOutput(execution.id, "stdout", { from: 5 });

    expect(incremental?.from).toBe(5);
    expect(incremental?.to).toBe(15);
    expect(incremental?.content).toBe("-then-more");
  });
});

function taskInput(): Omit<Task, "id" | "nextRunAt" | "lastRunAt" | "createdAt" | "updatedAt"> {
  return {
    title: "HoraAqui PR",
    prompt: "Process PRs",
    cwd: tempDir,
    schedule: { type: "manual" },
    enabled: true
  };
}
