export type ManualSchedule = {
  type: "manual";
};

export type OnceSchedule = {
  type: "once";
  runAt: string;
};

export type IntervalSchedule = {
  type: "interval";
  everyMinutes: number;
};

export type DailySchedule = {
  type: "daily";
  time: string;
};

export type WeeklySchedule = {
  type: "weekly";
  dayOfWeek: number;
  time: string;
};

export type CronSchedule = {
  type: "cron";
  expression: string;
};

export type ContinuousSchedule = {
  type: "continuous";
  stopAt?: string | null;
};

export type TaskSchedule =
  | ManualSchedule
  | OnceSchedule
  | IntervalSchedule
  | DailySchedule
  | WeeklySchedule
  | CronSchedule
  | ContinuousSchedule;

export type CodexEffort = "low" | "medium" | "high" | "xhigh" | null;

export const codexEffortOptions: Array<Exclude<CodexEffort, null>> = [
  "low",
  "medium",
  "high",
  "xhigh"
];

export type CodexModel = string | null;

export const codexModelOptions: Array<{ id: string; label: string }> = [
  { id: "gpt-5.5", label: "GPT-5.5" },
  { id: "gpt-5", label: "GPT-5" },
  { id: "gpt-5-codex", label: "GPT-5 Codex" },
  { id: "o3", label: "o3" },
  { id: "o4-mini", label: "o4-mini" }
];

export const DEFAULT_CODEX_EFFORT: CodexEffort = "xhigh";
export const DEFAULT_CODEX_MODEL: CodexModel = "gpt-5.5";

export type Task = {
  id: string;
  title: string;
  prompt: string;
  cwd: string;
  schedule: TaskSchedule;
  enabled: boolean;
  effort: CodexEffort;
  model: CodexModel;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExecutionStatus = "running" | "success" | "failed" | "stale" | "cancelled";

export type ExecutionTrigger = "manual" | "scheduled" | "resume" | "message";

export type Execution = {
  id: string;
  taskId: string;
  taskTitle: string;
  trigger: ExecutionTrigger;
  status: ExecutionStatus;
  startedAt: string;
  finishedAt: string | null;
  lastOutputAt: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  command: string[];
  cwd: string;
  prompt: string;
  effort: CodexEffort;
  model: CodexModel;
  error: string | null;
  processId: number | null;
  resumeSessionId: string | null;
  resumedFromExecutionId: string | null;
  staleAt: string | null;
  staleReason: string | null;
  cancelRequestedAt: string | null;
};

export type ExecutionSummary = Omit<Execution, "stdout" | "stderr"> & {
  stdoutSize: number;
  stderrSize: number;
};

export type OutputStream = "stdout" | "stderr";

export type ExecutionOutputChunk = {
  stream: OutputStream;
  from: number;
  to: number;
  totalSize: number;
  content: string;
};

export type DatabaseShape = {
  tasks: Task[];
  executions: Execution[];
};

export type CreateTaskInput = {
  title: string;
  prompt: string;
  cwd: string;
  schedule: TaskSchedule;
  enabled: boolean;
  effort: CodexEffort;
  model: CodexModel;
};

export type UpdateTaskInput = Partial<CreateTaskInput>;
