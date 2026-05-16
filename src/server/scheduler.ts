import { randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import {
  CANCEL_SIGKILL_AFTER_MS,
  SCHEDULER_TICK_MS
} from "./constants.js";
import {
  buildCodexCommand,
  buildCodexResumeCommand,
  formatCommand,
  runCodexCommand
} from "./runner.js";
import type { JsonStore } from "./store.js";
import type { Execution, ExecutionTrigger, Task } from "./types.js";

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly runningTaskIds = new Set<string>();
  private readonly runningExecutionIds = new Set<string>();
  private readonly runningProcesses = new Map<string, ChildProcess>();
  private readonly cancelledExecutionIds = new Set<string>();
  private readonly sigkillTimers = new Map<string, NodeJS.Timeout>();
  private tickInProgress = false;

  constructor(
    private readonly store: JsonStore,
    private readonly intervalMs = SCHEDULER_TICK_MS
  ) {}

  start(): void {
    if (this.timer) return;

    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);

    void this.tick();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async runTaskNow(taskId: string): Promise<Execution> {
    const task = this.store.getTask(taskId);
    if (!task) {
      throw new Error("Task not found.");
    }

    return this.launchTask(task, "manual");
  }

  async resumeExecution(executionId: string): Promise<Execution> {
    const staleExecution = this.store.getExecution(executionId);
    if (!staleExecution) {
      throw new Error("Execution not found.");
    }

    const task = this.store.getTask(staleExecution.taskId);
    if (!task) {
      throw new Error("Execution task not found.");
    }

    if (!staleExecution.resumeSessionId) {
      throw new Error("Could not find a Codex session id to continue this execution.");
    }

    return this.launchTask(task, "resume", {
      command: buildCodexResumeCommand(
        staleExecution.resumeSessionId,
        task.effort ?? null,
        task.model ?? null
      ),
      prompt: buildResumePrompt(task, staleExecution),
      resumeSessionId: staleExecution.resumeSessionId,
      resumedFromExecutionId: staleExecution.id
    });
  }

  async cancelExecution(executionId: string): Promise<{ status: "cancelling" | "already_finished" }> {
    const execution = this.store.getExecution(executionId);
    if (!execution) {
      throw new HttpError(404, "Execution not found.");
    }
    if (execution.status !== "running") {
      return { status: "already_finished" };
    }

    await this.store.markExecutionCancelRequested(executionId);
    this.cancelledExecutionIds.add(executionId);

    const child = this.runningProcesses.get(executionId);
    if (!child) {
      return { status: "cancelling" };
    }

    sendSignal(child, "SIGTERM");

    const existingTimer = this.sigkillTimers.get(executionId);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      const stillRunning = this.runningProcesses.get(executionId);
      if (stillRunning) sendSignal(stillRunning, "SIGKILL");
      this.sigkillTimers.delete(executionId);
    }, CANCEL_SIGKILL_AFTER_MS);
    this.sigkillTimers.set(executionId, timer);

    return { status: "cancelling" };
  }

  private async tick(): Promise<void> {
    if (this.tickInProgress) return;
    this.tickInProgress = true;

    try {
      await this.reconcileUntrackedExecutions();
      const dueTasks = this.store.listDueTasks(new Date());

      for (const task of dueTasks) {
        if (!this.runningTaskIds.has(task.id)) {
          await this.launchTask(task, "scheduled");
        }
      }
    } finally {
      this.tickInProgress = false;
    }
  }

  private async launchTask(
    task: Task,
    trigger: ExecutionTrigger,
    options: {
      command?: ReturnType<typeof buildCodexCommand>;
      prompt?: string;
      resumeSessionId?: string | null;
      resumedFromExecutionId?: string | null;
    } = {}
  ): Promise<Execution> {
    if (this.runningTaskIds.has(task.id)) {
      throw new Error("This task is already running.");
    }

    // Reserve the execution id and register it before awaiting the DB write,
    // otherwise reconcileUntrackedExecutions can race with createExecution and
    // mark this run "stale" before launchTask resumes to add it to the set.
    const executionId = randomUUID();
    this.runningTaskIds.add(task.id);
    this.runningExecutionIds.add(executionId);

    const effort = task.effort ?? null;
    const model = task.model ?? null;
    const command = options.command ?? buildCodexCommand(task.cwd, effort, model);

    let execution: Execution;
    try {
      execution = await this.store.createExecution({
        id: executionId,
        task,
        trigger,
        command: formatCommand(command),
        prompt: options.prompt,
        effort,
        model,
        resumeSessionId: options.resumeSessionId,
        resumedFromExecutionId: options.resumedFromExecutionId
      });
    } catch (error) {
      this.runningTaskIds.delete(task.id);
      this.runningExecutionIds.delete(executionId);
      throw error;
    }

    void this.executeTask(task, execution.id, command, options.prompt ?? task.prompt);
    return execution;
  }

  private async executeTask(
    task: Task,
    executionId: string,
    command: ReturnType<typeof buildCodexCommand>,
    prompt: string
  ): Promise<void> {
    try {
      const result = await runCodexCommand(command, task.cwd, prompt, {
        onStart: (child) => {
          this.runningProcesses.set(executionId, child);
          if (child.pid) {
            void this.store.setExecutionProcessId(executionId, child.pid);
          }
        },
        onStdout: (chunk) => this.store.appendExecutionOutput(executionId, "stdout", chunk),
        onStderr: (chunk) => this.store.appendExecutionOutput(executionId, "stderr", chunk)
      });

      const wasCancelled = this.cancelledExecutionIds.has(executionId);
      const status = wasCancelled
        ? "cancelled"
        : result.exitCode === 0
          ? "success"
          : "failed";
      const error = wasCancelled ? "Execution cancelled by user." : null;
      await this.store.finishExecution(executionId, {
        status,
        exitCode: result.exitCode,
        error
      });
    } catch (error) {
      const wasCancelled = this.cancelledExecutionIds.has(executionId);
      await this.store.finishExecution(executionId, {
        status: wasCancelled ? "cancelled" : "failed",
        exitCode: null,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      await this.store.finishTaskRun(task.id);
      this.runningTaskIds.delete(task.id);
      this.runningExecutionIds.delete(executionId);
      this.runningProcesses.delete(executionId);
      this.cancelledExecutionIds.delete(executionId);
      const timer = this.sigkillTimers.get(executionId);
      if (timer) {
        clearTimeout(timer);
        this.sigkillTimers.delete(executionId);
      }
    }
  }

  private async reconcileUntrackedExecutions(): Promise<void> {
    const staleExecutions = await this.store.markUntrackedRunningExecutions(this.runningExecutionIds);
    for (const execution of staleExecutions) {
      await this.store.finishTaskRun(execution.taskId);
    }
  }
}

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function sendSignal(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // process already gone — nothing to do.
    }
  }
}

function buildResumePrompt(task: Task, execution: Execution): string {
  return `Continue the previous execution for routine "${task.title}".

Execution ${execution.id} became orphaned/stuck in the local platform, but a previous Codex session is available to resume: ${execution.resumeSessionId}.

Resume from the current workspace state (${execution.cwd}). Preserve existing changes, do not revert user changes, resolve conflicts if needed, and continue the original routine goal to a clear conclusion.`;
}
