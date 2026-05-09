import { buildCodexCommand, buildCodexResumeCommand, formatCommand, runCodexCommand } from "./runner.js";
import type { JsonStore } from "./store.js";
import type { Execution, ExecutionTrigger, Task } from "./types.js";

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly runningTaskIds = new Set<string>();
  private readonly runningExecutionIds = new Set<string>();
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

  async resumeExecution(executionId: string): Promise<Execution> {
    const staleExecution = this.store.getExecution(executionId);
    if (!staleExecution) {
      throw new Error("Execucao nao encontrada.");
    }

    const task = this.store.getTask(staleExecution.taskId);
    if (!task) {
      throw new Error("Tarefa da execucao nao encontrada.");
    }

    if (!staleExecution.resumeSessionId) {
      throw new Error("Nao encontrei session id do Codex para continuar esta execucao.");
    }

    return this.launchTask(task, "resume", {
      command: buildCodexResumeCommand(staleExecution.resumeSessionId),
      prompt: buildResumePrompt(task, staleExecution),
      resumeSessionId: staleExecution.resumeSessionId,
      resumedFromExecutionId: staleExecution.id
    });
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
      throw new Error("Esta tarefa ja esta em execucao.");
    }

    this.runningTaskIds.add(task.id);
    const command = options.command ?? buildCodexCommand(task.cwd);
    const execution = await this.store.createExecution({
      task,
      trigger,
      command: formatCommand(command),
      prompt: options.prompt,
      resumeSessionId: options.resumeSessionId,
      resumedFromExecutionId: options.resumedFromExecutionId
    });
    this.runningExecutionIds.add(execution.id);

    void this.executeTask(task, execution.id, command, options.prompt ?? task.prompt);
    return execution;
  }

  private async executeTask(task: Task, executionId: string, command: ReturnType<typeof buildCodexCommand>, prompt: string): Promise<void> {
    try {
      const result = await runCodexCommand(command, task.cwd, prompt, {
        onStart: (pid) => this.store.setExecutionProcessId(executionId, pid),
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
      this.runningExecutionIds.delete(executionId);
    }
  }

  private async reconcileUntrackedExecutions(): Promise<void> {
    const staleExecutions = await this.store.markUntrackedRunningExecutions(this.runningExecutionIds);
    for (const execution of staleExecutions) {
      await this.store.finishTaskRun(execution.taskId);
    }
  }
}

function buildResumePrompt(task: Task, execution: Execution): string {
  return `Continue a execucao anterior da rotina "${task.title}".

A execucao ${execution.id} ficou orfa/travada na plataforma local, mas existe uma sessao Codex anterior para retomar: ${execution.resumeSessionId}.

Retome a partir do estado atual do workspace (${execution.cwd}). Preserve mudancas existentes, nao reverta alteracoes do usuario, resolva conflitos se necessario e siga o objetivo original da rotina ate uma conclusao clara.`;
}
