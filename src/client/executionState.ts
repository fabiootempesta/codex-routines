import type { Execution } from "../server/types";

export function findRunningExecution(executions: Execution[], taskId: string): Execution | null {
  return executions
    .filter((execution) => execution.taskId === taskId && execution.status === "running")
    .sort(compareExecutionNewestFirst)[0] ?? null;
}

export function mergeExecutionIntoList(executions: Execution[], execution: Execution): Execution[] {
  const withoutCurrent = executions.filter((item) => item.id !== execution.id);
  return [execution, ...withoutCurrent].sort(compareExecutionNewestFirst);
}

export function resolveExecutionSelection(input: {
  currentId: string | null;
  executions: Execution[];
  taskId: string;
  preferRunning?: boolean;
}): string | null {
  if (input.preferRunning) {
    const running = findRunningExecution(input.executions, input.taskId);
    if (running) return running.id;
  }

  if (input.currentId && input.executions.some((execution) => execution.id === input.currentId)) {
    return input.currentId;
  }

  return input.executions[0]?.id ?? null;
}

export function isContinuableExecution(execution: Execution | null): boolean {
  if (!execution?.resumeSessionId) return false;
  return execution.status === "stale" || execution.status === "failed";
}

function compareExecutionNewestFirst(left: Execution, right: Execution): number {
  return right.startedAt.localeCompare(left.startedAt);
}
