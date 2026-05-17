import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Scheduler } from "../src/server/scheduler";
import { JsonStore } from "../src/server/store";
import type { Task } from "../src/server/types";

const { runCodexCommand } = vi.hoisted(() => ({
  runCodexCommand: vi.fn(async () => ({ exitCode: 0, signal: null }))
}));

vi.mock("../src/server/runner", () => ({
  buildCodexCommand: (cwd: string) => ({
    file: "codex",
    args: ["exec", "--cd", cwd, "-"]
  }),
  buildCodexResumeCommand: (sessionId: string) => ({
    file: "codex",
    args: ["exec", "resume", sessionId, "-"]
  }),
  formatCommand: (command: { file: string; args: string[] }) => [command.file, ...command.args],
  runCodexCommand
}));

let tempDir: string;
let store: JsonStore;
let scheduler: Scheduler;

describe("Scheduler message execution", () => {
  beforeEach(async () => {
    runCodexCommand.mockClear();
    tempDir = await mkdtemp(path.join(os.tmpdir(), "codex-routines-message-"));
    store = new JsonStore(path.join(tempDir, "db.json"));
    await store.init();
    scheduler = new Scheduler(store);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  });

  it("starts a tracked resume execution with the user's follow-up message", async () => {
    const task = await store.createTask(taskInput());
    const source = await store.createExecution({
      task,
      trigger: "manual",
      command: ["codex", "exec"],
      effort: null,
      model: null
    });
    await store.appendExecutionOutput(
      source.id,
      "stderr",
      "session id: 019e0dc0-bc6d-7c32-8520-2f1130559c89\n"
    );
    await store.finishExecution(source.id, { status: "success", exitCode: 0 });

    const execution = await scheduler.messageExecution(source.id, "Check the failing tests again.");

    expect(execution.trigger).toBe("message");
    expect(execution.prompt).toBe("Check the failing tests again.");
    expect(execution.resumedFromExecutionId).toBe(source.id);
    expect(execution.resumeSessionId).toBe("019e0dc0-bc6d-7c32-8520-2f1130559c89");
    expect(execution.command).toEqual([
      "codex",
      "exec",
      "resume",
      "019e0dc0-bc6d-7c32-8520-2f1130559c89",
      "-"
    ]);
    await vi.waitFor(() => {
      expect(store.getExecution(execution.id)?.status).toBe("success");
      expect(store.getTask(task.id)?.lastRunAt).not.toBeNull();
    });
  });
});

function taskInput(): Omit<Task, "id" | "nextRunAt" | "lastRunAt" | "createdAt" | "updatedAt"> {
  return {
    title: "HoraAqui PR",
    prompt: "Process PRs",
    cwd: tempDir,
    schedule: { type: "manual" },
    enabled: true,
    effort: null,
    model: null
  };
}
