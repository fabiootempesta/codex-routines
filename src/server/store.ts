import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getNextRunAt } from "./schedules.js";
import type {
  CreateTaskInput,
  DatabaseShape,
  Execution,
  ExecutionStatus,
  ExecutionTrigger,
  Task,
  UpdateTaskInput
} from "./types.js";

const defaultDatabase: DatabaseShape = {
  tasks: [],
  executions: []
};

export class JsonStore {
  private database: DatabaseShape = structuredClone(defaultDatabase);
  private mutationQueue = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async init(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await readFile(this.filePath, "utf8");
      this.database = normalizeDatabase(JSON.parse(raw) as Partial<DatabaseShape>);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }

      await this.persist();
    }
  }

  listTasks(): Task[] {
    return [...this.database.tasks].sort(compareNewestFirst);
  }

  getTask(id: string): Task | null {
    return this.database.tasks.find((task) => task.id === id) ?? null;
  }

  listDueTasks(now = new Date()): Task[] {
    return this.database.tasks
      .filter((task) => task.enabled && task.nextRunAt !== null && new Date(task.nextRunAt) <= now)
      .sort((left, right) => String(left.nextRunAt).localeCompare(String(right.nextRunAt)));
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    return this.mutate(() => {
      const now = new Date();
      const task: Task = {
        id: randomUUID(),
        title: input.title.trim(),
        prompt: input.prompt,
        cwd: input.cwd,
        schedule: input.schedule,
        enabled: input.enabled,
        nextRunAt: input.enabled ? getNextRunAt(input.schedule, now)?.toISOString() ?? null : null,
        lastRunAt: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      };

      this.database.tasks.push(task);
      return task;
    });
  }

  async updateTask(id: string, input: UpdateTaskInput): Promise<Task | null> {
    return this.mutate(() => {
      const task = this.getTask(id);
      if (!task) return null;

      const previousSchedule = JSON.stringify(task.schedule);
      const previousEnabled = task.enabled;
      const now = new Date();

      if (input.title !== undefined) task.title = input.title.trim();
      if (input.prompt !== undefined) task.prompt = input.prompt;
      if (input.cwd !== undefined) task.cwd = input.cwd;
      if (input.schedule !== undefined) task.schedule = input.schedule;
      if (input.enabled !== undefined) task.enabled = input.enabled;

      const scheduleChanged = previousSchedule !== JSON.stringify(task.schedule);
      const enabledChanged = previousEnabled !== task.enabled;

      if (!task.enabled) {
        task.nextRunAt = null;
      } else if (scheduleChanged || enabledChanged || task.nextRunAt === null) {
        task.nextRunAt = getNextRunAt(task.schedule, now)?.toISOString() ?? null;
      }

      task.updatedAt = now.toISOString();
      return task;
    });
  }

  async deleteTask(id: string): Promise<boolean> {
    return this.mutate(() => {
      const previousLength = this.database.tasks.length;
      this.database.tasks = this.database.tasks.filter((task) => task.id !== id);
      return this.database.tasks.length !== previousLength;
    });
  }

  listExecutions(taskId?: string): Execution[] {
    return this.database.executions
      .filter((execution) => !taskId || execution.taskId === taskId)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .slice(0, 200);
  }

  getExecution(id: string): Execution | null {
    return this.database.executions.find((execution) => execution.id === id) ?? null;
  }

  async createExecution(input: {
    task: Task;
    trigger: ExecutionTrigger;
    command: string[];
    prompt?: string;
    resumeSessionId?: string | null;
    resumedFromExecutionId?: string | null;
  }): Promise<Execution> {
    return this.mutate(() => {
      const now = new Date();
      const execution: Execution = {
        id: randomUUID(),
        taskId: input.task.id,
        taskTitle: input.task.title,
        trigger: input.trigger,
        status: "running",
        startedAt: now.toISOString(),
        finishedAt: null,
        lastOutputAt: now.toISOString(),
        exitCode: null,
        stdout: "",
        stderr: "",
        command: input.command,
        cwd: input.task.cwd,
        prompt: input.prompt ?? input.task.prompt,
        error: null,
        processId: null,
        resumeSessionId: input.resumeSessionId ?? null,
        resumedFromExecutionId: input.resumedFromExecutionId ?? null,
        staleAt: null,
        staleReason: null
      };

      this.database.executions.push(execution);
      return execution;
    });
  }

  async setExecutionProcessId(id: string, processId: number): Promise<void> {
    await this.mutate(() => {
      const execution = this.getExecution(id);
      if (!execution) return;

      execution.processId = processId;
    });
  }

  async appendExecutionOutput(id: string, stream: "stdout" | "stderr", chunk: string): Promise<void> {
    await this.mutate(() => {
      const execution = this.getExecution(id);
      if (!execution) return;

      execution[stream] += chunk;
      execution.lastOutputAt = new Date().toISOString();
      execution.resumeSessionId = execution.resumeSessionId ?? extractCodexSessionId(chunk);
    });
  }

  async markUntrackedRunningExecutions(activeExecutionIds: Set<string>, now = new Date()): Promise<Execution[]> {
    return this.mutate(() => {
      const staleAt = now.toISOString();
      const stale: Execution[] = [];

      for (const execution of this.database.executions) {
        if (execution.status !== "running" || activeExecutionIds.has(execution.id)) continue;

        const reason = execution.processId
          ? `Orphaned execution: the platform is no longer tracking process ${execution.processId}.`
          : "Orphaned execution: the platform restarted or lost this execution's Codex process.";

        execution.status = "stale";
        execution.finishedAt = staleAt;
        execution.exitCode = null;
        execution.staleAt = staleAt;
        execution.staleReason = reason;
        execution.error = reason;
        execution.stderr = appendLogLine(execution.stderr, `[codex-routines] ${reason}`);
        stale.push(execution);
      }

      return stale;
    });
  }

  async finishExecution(
    id: string,
    result: { status: ExecutionStatus; exitCode: number | null; error?: string | null }
  ): Promise<Execution | null> {
    return this.mutate(() => {
      const execution = this.getExecution(id);
      if (!execution) return null;

      execution.status = result.status;
      execution.exitCode = result.exitCode;
      execution.error = result.error ?? null;
      execution.finishedAt = new Date().toISOString();
      return execution;
    });
  }

  async finishTaskRun(taskId: string): Promise<Task | null> {
    return this.mutate(() => {
      const task = this.getTask(taskId);
      if (!task) return null;

      const now = new Date();
      task.lastRunAt = now.toISOString();

      if (!task.enabled || task.schedule.type === "manual") {
        task.nextRunAt = null;
      } else {
        task.nextRunAt = getNextRunAt(task.schedule, now)?.toISOString() ?? null;
      }

      if (task.schedule.type === "once") {
        task.enabled = false;
        task.nextRunAt = null;
      }

      task.updatedAt = now.toISOString();
      return task;
    });
  }

  private async mutate<T>(mutator: () => T): Promise<T> {
    const operation = this.mutationQueue.then(async () => {
      const result = mutator();
      await this.persist();
      return result;
    });

    this.mutationQueue = operation.then(
      () => undefined,
      () => undefined
    );

    return operation;
  }

  private async persist(): Promise<void> {
    const tmpPath = `${this.filePath}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(this.database, null, 2)}\n`, "utf8");
    await rename(tmpPath, this.filePath);
  }
}

export function createStorePath(root = process.cwd()): string {
  return process.env.CODEX_ROUTINES_DB ?? path.join(root, "data", "db.json");
}

export async function assertDirectory(directory: string): Promise<void> {
  if (!path.isAbsolute(directory)) {
    throw new Error("Path must be absolute.");
  }

  const result = await stat(directory);
  if (!result.isDirectory()) {
    throw new Error("Path must point to a directory.");
  }
}

function normalizeDatabase(input: Partial<DatabaseShape>): DatabaseShape {
  return {
    tasks: Array.isArray(input.tasks) ? input.tasks : [],
    executions: Array.isArray(input.executions) ? input.executions.map(normalizeExecution) : []
  };
}

function normalizeExecution(input: Execution): Execution {
  const lastOutputAt = input.lastOutputAt ?? input.finishedAt ?? input.startedAt;
  const resumeSessionId = input.resumeSessionId ?? extractCodexSessionId(`${input.stderr ?? ""}\n${input.stdout ?? ""}`);

  return {
    ...input,
    lastOutputAt,
    processId: input.processId ?? null,
    resumeSessionId,
    resumedFromExecutionId: input.resumedFromExecutionId ?? null,
    staleAt: input.staleAt ?? null,
    staleReason: input.staleReason ?? null
  };
}

function extractCodexSessionId(value: string): string | null {
  return value.match(/session id:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1] ?? null;
}

function appendLogLine(current: string, line: string): string {
  if (!current) return `${line}\n`;
  return current.endsWith("\n") ? `${current}${line}\n` : `${current}\n${line}\n`;
}

function compareNewestFirst(left: Task, right: Task): number {
  return right.createdAt.localeCompare(left.createdAt);
}
