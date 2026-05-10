import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import os from "node:os";
import { z } from "zod";
import { assertDirectory, JsonStore } from "./store.js";
import type { Scheduler } from "./scheduler.js";
import type { Execution, ExecutionSummary } from "./types.js";

const DEFAULT_OUTPUT_TAIL = 64 * 1024;
const MAX_OUTPUT_LENGTH = 1024 * 1024;

const scheduleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("manual") }),
  z.object({ type: z.literal("once"), runAt: z.string().min(1) }),
  z.object({ type: z.literal("interval"), everyMinutes: z.coerce.number().int().min(1) }),
  z.object({ type: z.literal("daily"), time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/) }),
  z.object({
    type: z.literal("weekly"),
    dayOfWeek: z.coerce.number().int().min(0).max(6),
    time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
  }),
  z.object({ type: z.literal("cron"), expression: z.string().min(3) })
]);

const taskCreateSchema = z.object({
  title: z.string().trim().min(1),
  prompt: z.string().min(1),
  cwd: z.string().trim().min(1),
  enabled: z.boolean().default(true),
  schedule: scheduleSchema
});

const taskUpdateSchema = taskCreateSchema.partial();

export function createApiRouter(store: JsonStore, scheduler: Scheduler): Router {
  const router = Router();

  router.get("/health", (_request, response) => {
    response.json({ ok: true, homeDir: os.homedir() });
  });

  router.get("/tasks", (_request, response) => {
    response.json({ tasks: store.listTasks() });
  });

  router.post(
    "/tasks",
    asyncHandler(async (request, response) => {
      const payload = taskCreateSchema.parse(request.body);
      await assertDirectory(payload.cwd);
      const task = await store.createTask(payload);
      response.status(201).json({ task });
    })
  );

  router.put(
    "/tasks/:id",
    asyncHandler(async (request, response) => {
      const payload = taskUpdateSchema.parse(request.body);

      if (payload.cwd) {
        await assertDirectory(payload.cwd);
      }

      const task = await store.updateTask(request.params.id, payload);

      if (!task) {
        response.status(404).json({ error: "Task not found." });
        return;
      }

      response.json({ task });
    })
  );

  router.delete(
    "/tasks/:id",
    asyncHandler(async (request, response) => {
      const deleted = await store.deleteTask(request.params.id);

      if (!deleted) {
        response.status(404).json({ error: "Task not found." });
        return;
      }

      response.status(204).end();
    })
  );

  router.post(
    "/tasks/:id/run",
    asyncHandler(async (request, response) => {
      const execution = await scheduler.runTaskNow(request.params.id);
      response.status(202).json({ execution: toSummary(execution) });
    })
  );

  router.get("/executions", (request, response) => {
    const taskId = typeof request.query.taskId === "string" ? request.query.taskId : undefined;
    response.json({ executions: store.listExecutionSummaries(taskId) });
  });

  router.get("/executions/:id", (request, response) => {
    const execution = store.getExecutionSummary(request.params.id);

    if (!execution) {
      response.status(404).json({ error: "Execution not found." });
      return;
    }

    response.json({ execution });
  });

  router.get("/executions/:id/output", (request, response) => {
    const stream = request.query.stream === "stderr" ? "stderr" : "stdout";
    const from = parseIntParam(request.query.from);
    const to = parseIntParam(request.query.to);
    const tail = parseIntParam(request.query.tail) ?? DEFAULT_OUTPUT_TAIL;

    const requested = (to ?? Infinity) - (from ?? 0);
    if (Number.isFinite(requested) && requested > MAX_OUTPUT_LENGTH) {
      response.status(400).json({ error: `Range exceeds ${MAX_OUTPUT_LENGTH} bytes.` });
      return;
    }

    const output = store.getExecutionOutput(request.params.id, stream, {
      from: from ?? undefined,
      to: to ?? undefined,
      tail
    });

    if (!output) {
      response.status(404).json({ error: "Execution not found." });
      return;
    }

    response.json({ output });
  });

  router.post(
    "/executions/:id/resume",
    asyncHandler(async (request, response) => {
      const execution = await scheduler.resumeExecution(request.params.id);
      response.status(202).json({ execution: toSummary(execution) });
    })
  );

  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) {
      response.status(400).json({ error: "Invalid data.", details: error.flatten() });
      return;
    }

    response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  });

  return router;
}

function asyncHandler(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<void>
) {
  return (request: Request, response: Response, next: NextFunction) => {
    handler(request, response, next).catch(next);
  };
}

function toSummary(execution: Execution): ExecutionSummary {
  const { stdout, stderr, ...rest } = execution;
  return {
    ...rest,
    stdoutSize: stdout.length,
    stderrSize: stderr.length
  };
}

function parseIntParam(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
