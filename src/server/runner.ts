import { spawn, type ChildProcess } from "node:child_process";
import type { CodexEffort, CodexModel, Task } from "./types.js";

export type CodexCommand = {
  file: string;
  args: string[];
};

export type CodexRunResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
};

export type CodexRunEvents = {
  onStart?: (child: ChildProcess) => void | Promise<void>;
  onStdout?: (chunk: string) => void | Promise<void>;
  onStderr?: (chunk: string) => void | Promise<void>;
};

function modelArgs(model: CodexModel): string[] {
  return model ? ["--model", model] : [];
}

function effortArgs(effort: CodexEffort): string[] {
  return effort ? ["-c", `model_reasoning_effort=${effort}`] : [];
}

export function buildCodexCommand(
  cwd: string,
  effort: CodexEffort = null,
  model: CodexModel = null
): CodexCommand {
  return {
    file: "codex",
    args: [
      "exec",
      ...modelArgs(model),
      ...effortArgs(effort),
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "--color",
      "never",
      "--cd",
      cwd,
      "-"
    ]
  };
}

export function buildCodexResumeCommand(
  sessionId: string,
  effort: CodexEffort = null,
  model: CodexModel = null
): CodexCommand {
  return {
    file: "codex",
    args: [
      "exec",
      ...modelArgs(model),
      ...effortArgs(effort),
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "--color",
      "never",
      "resume",
      sessionId,
      "-"
    ]
  };
}

export function formatCommand(command: CodexCommand): string[] {
  return [command.file, ...command.args];
}

export function runCodexTask(task: Task, events: CodexRunEvents = {}): Promise<CodexRunResult> {
  return runCodexCommand(
    buildCodexCommand(task.cwd, task.effort ?? null, task.model ?? null),
    task.cwd,
    task.prompt,
    events
  );
}

export function runCodexCommand(
  command: CodexCommand,
  cwd: string,
  prompt: string,
  events: CodexRunEvents = {}
): Promise<CodexRunResult> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;

    try {
      child = spawn(command.file, command.args, {
        cwd,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: true
      });
    } catch (error) {
      reject(error);
      return;
    }

    void events.onStart?.(child);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    child.stdout?.on("data", (chunk: string) => {
      void events.onStdout?.(chunk);
    });

    child.stderr?.on("data", (chunk: string) => {
      void events.onStderr?.(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (exitCode, signal) => {
      resolve({ exitCode, signal });
    });

    child.stdin?.write(prompt);
    child.stdin?.end();
  });
}
