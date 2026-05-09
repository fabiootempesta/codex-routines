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

export function formatCommand(command: CodexCommand): string[] {
  return [command.file, ...command.args];
}

export function runCodexTask(task: Task, events: CodexRunEvents = {}): Promise<CodexRunResult> {
  const command = buildCodexCommand(task.cwd);

  return new Promise((resolve, reject) => {
    let child;

    try {
      child = spawn(command.file, command.args, {
        cwd: task.cwd,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch (error) {
      reject(error);
      return;
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

    child.stdin.write(task.prompt);
    child.stdin.end();
  });
}
