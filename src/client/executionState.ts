import type { ExecutionSummary } from "../server/types";

export function findRunningExecution(executions: ExecutionSummary[], taskId: string): ExecutionSummary | null {
  return executions
    .filter((execution) => execution.taskId === taskId && execution.status === "running")
    .sort(compareExecutionNewestFirst)[0] ?? null;
}

export function mergeExecutionIntoList(
  executions: ExecutionSummary[],
  execution: ExecutionSummary
): ExecutionSummary[] {
  const withoutCurrent = executions.filter((item) => item.id !== execution.id);
  return [execution, ...withoutCurrent].sort(compareExecutionNewestFirst);
}

export function resolveExecutionSelection(input: {
  currentId: string | null;
  executions: ExecutionSummary[];
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

export function isContinuableExecution(execution: ExecutionSummary | null): boolean {
  if (!execution?.resumeSessionId) return false;
  return execution.status === "stale" || execution.status === "failed";
}

function compareExecutionNewestFirst(left: ExecutionSummary, right: ExecutionSummary): number {
  return right.startedAt.localeCompare(left.startedAt);
}
