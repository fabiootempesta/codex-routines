import { spawn } from "node:child_process";
import type { Task } from "./types.js";

export type CodexCommand = {
  file: string;
  args: string[];
};

export type CodexRunResult = {
  exitCode: number | null;
};

export type CodexRunEvents = {
  onStart?: (pid: number) => void | Promise<void>;
  onStdout?: (chunk: string) => void | Promise<void>;
  onStderr?: (chunk: string) => void | Promise<void>;
};

export function buildCodexCommand(cwd: string): CodexCommand {
  return {
    file: "codex",
    args: [
      "exec",
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

export function buildCodexResumeCommand(sessionId: string): CodexCommand {
  return {
    file: "codex",
    args: [
      "exec",
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
  return runCodexCommand(buildCodexCommand(task.cwd), task.cwd, task.prompt, events);
}

export function runCodexCommand(
  command: CodexCommand,
  cwd: string,
  prompt: string,
  events: CodexRunEvents = {}
): Promise<CodexRunResult> {
  return new Promise((resolve, reject) => {
    let child;

    try {
      child = spawn(command.file, command.args, {
        cwd,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch (error) {
      reject(error);
      return;
    }

    if (child.pid) {
      void events.onStart?.(child.pid);
    }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      void events.onStdout?.(chunk);
    });

    child.stderr.on("data", (chunk: string) => {
      void events.onStderr?.(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (exitCode) => {
      resolve({ exitCode });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}
