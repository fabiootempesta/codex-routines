// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/client/App";
import type { Task } from "../src/server/types";

const task: Task = {
  id: "task-1",
  title: "Saved routine",
  prompt: "# Saved\n\nPrompt",
  cwd: "/tmp",
  schedule: { type: "manual" },
  enabled: true,
  effort: null,
  model: null,
  nextRunAt: null,
  lastRunAt: null,
  createdAt: "2026-05-09T12:00:00.000Z",
  updatedAt: "2026-05-09T12:00:00.000Z"
};

describe("App draft refresh behavior", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps unsaved edits when the background task refresh returns the saved task", async () => {
    vi.useFakeTimers();
    mockApi();

    render(<App />);

    await flushPromises();
    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    expect(nameInput.value).toBe("Saved routine");

    fireEvent.change(nameInput, { target: { value: "Unsaved local title" } });

    await act(async () => {
      vi.advanceTimersByTime(4_000);
      await flushPromises();
    });

    expect(nameInput.value).toBe("Unsaved local title");
  });

  it("does not show Default as a selectable model or effort option", async () => {
    vi.useFakeTimers();
    mockApi();

    render(<App />);

    await flushPromises();

    expect(screen.queryByRole("button", { name: "Default" })).toBeNull();
  });
});

function mockApi() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === "/api/health") {
        return jsonResponse({ ok: true, homeDir: "/tmp" });
      }

      if (url === "/api/tasks") {
        return jsonResponse({ tasks: [task] });
      }

      if (url === "/api/executions" || url === "/api/executions?taskId=task-1") {
        return jsonResponse({ executions: [] });
      }

      return jsonResponse({ error: `Unhandled test URL: ${url}` }, 404);
    })
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}
