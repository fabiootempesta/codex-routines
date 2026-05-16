import { describe, expect, it } from "vitest";
import { buildCodexCommand, buildCodexResumeCommand } from "../src/server/runner";

describe("buildCodexCommand", () => {
  it("uses non-interactive Codex with bypass flags and the selected cwd", () => {
    const command = buildCodexCommand("/tmp/codex-routines-fixture");

    expect(command.file).toBe("codex");
    expect(command.args).toEqual([
      "exec",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "--color",
      "never",
      "--cd",
      "/tmp/codex-routines-fixture",
      "-"
    ]);
  });

  it("builds a non-interactive Codex resume command for a previous session", () => {
    const command = buildCodexResumeCommand("019e0dc0-bc6d-7c32-8520-2f1130559c89");

    expect(command.file).toBe("codex");
    expect(command.args).toEqual([
      "exec",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "--color",
      "never",
      "resume",
      "019e0dc0-bc6d-7c32-8520-2f1130559c89",
      "-"
    ]);
  });

  it("includes --model and -c model_reasoning_effort when set", () => {
    const command = buildCodexCommand("/tmp/x", "xhigh", "gpt-5.5");

    expect(command.args).toEqual([
      "exec",
      "--model",
      "gpt-5.5",
      "-c",
      "model_reasoning_effort=xhigh",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "--color",
      "never",
      "--cd",
      "/tmp/x",
      "-"
    ]);
  });

  it("includes --model and -c model_reasoning_effort on resume commands too", () => {
    const command = buildCodexResumeCommand(
      "019e0dc0-bc6d-7c32-8520-2f1130559c89",
      "high",
      "gpt-5-codex"
    );

    expect(command.args).toEqual([
      "exec",
      "--model",
      "gpt-5-codex",
      "-c",
      "model_reasoning_effort=high",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "--color",
      "never",
      "resume",
      "019e0dc0-bc6d-7c32-8520-2f1130559c89",
      "-"
    ]);
  });
});
