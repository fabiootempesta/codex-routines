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

export type TaskSchedule =
  | ManualSchedule
  | OnceSchedule
  | IntervalSchedule
  | DailySchedule
  | WeeklySchedule
  | CronSchedule;

export type Task = {
  id: string;
  title: string;
  prompt: string;
  cwd: string;
  schedule: TaskSchedule;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExecutionStatus = "running" | "success" | "failed" | "stale";

export type ExecutionTrigger = "manual" | "scheduled" | "resume";

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
  error: string | null;
  processId: number | null;
  resumeSessionId: string | null;
  resumedFromExecutionId: string | null;
  staleAt: string | null;
  staleReason: string | null;
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
};

export type UpdateTaskInput = Partial<CreateTaskInput>;
