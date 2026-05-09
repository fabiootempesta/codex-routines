import { buildCodexCommand, formatCommand, runCodexTask } from "./runner.js";
import type { JsonStore } from "./store.js";
import type { Execution, ExecutionTrigger, Task } from "./types.js";

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly runningTaskIds = new Set<string>();
  private tickInProgress = false;

  constructor(
    private readonly store: JsonStore,
    private readonly intervalMs = 5_000
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
      throw new Error("Tarefa nao encontrada.");
    }

    return this.launchTask(task, "manual");
  }

  private async tick(): Promise<void> {
    if (this.tickInProgress) return;
    this.tickInProgress = true;

    try {
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

  private async launchTask(task: Task, trigger: ExecutionTrigger): Promise<Execution> {
    if (this.runningTaskIds.has(task.id)) {
      throw new Error("Esta tarefa ja esta em execucao.");
    }

    this.runningTaskIds.add(task.id);
    const command = buildCodexCommand(task.cwd);
    const execution = await this.store.createExecution({
      task,
      trigger,
      command: formatCommand(command)
    });

    void this.executeTask(task, execution.id);
    return execution;
  }

  private async executeTask(task: Task, executionId: string): Promise<void> {
    try {
      const result = await runCodexTask(task, {
        onStdout: (chunk) => this.store.appendExecutionOutput(executionId, "stdout", chunk),
        onStderr: (chunk) => this.store.appendExecutionOutput(executionId, "stderr", chunk)
      });

      await this.store.finishExecution(executionId, {
        status: result.exitCode === 0 ? "success" : "failed",
        exitCode: result.exitCode
      });
    } catch (error) {
      await this.store.finishExecution(executionId, {
        status: "failed",
        exitCode: null,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      await this.store.finishTaskRun(task.id);
      this.runningTaskIds.delete(task.id);
    }
  }
}
