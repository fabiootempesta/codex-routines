import { describe, expect, it } from "vitest";
import { buildCodexCommand } from "../src/server/runner";

describe("buildCodexCommand", () => {
  it("uses non-interactive Codex with bypass flags and the selected cwd", () => {
    const command = buildCodexCommand("/tmp/codex-rotinas-fixture");

    expect(command.file).toBe("codex");
    expect(command.args).toEqual([
      "exec",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "--color",
      "never",
      "--cd",
      "/tmp/codex-rotinas-fixture",
      "-"
    ]);
  });
});
