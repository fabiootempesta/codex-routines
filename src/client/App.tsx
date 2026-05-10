import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type FormEvent,
  type ReactNode
} from "react";
import ReactMarkdown from "react-markdown";
import {
  AlertTriangle,
  Check,
  Copy,
  FileText,
  Folder,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  X,
  Zap
} from "lucide-react";
import { Cron } from "croner";
import {
  findRunningExecution,
  isContinuableExecution,
  mergeExecutionIntoList
} from "./executionState";
import type {
  CreateTaskInput,
  Execution,
  ExecutionStatus,
  Task,
  TaskSchedule
} from "../server/types";

type DraftTask = CreateTaskInput & { id?: string };

type ApiState = {
  tasks: Task[];
  executions: Execution[];
};

type DaemonState = "online" | "error" | "loading";

const fallbackCwd = "/";
const REFRESH_MS = 4_000;
const RUNNING_POLL_MS = 1_200;
const SPARKLINE_LIMIT = 10;
const RIBBON_HORIZON_MS = 24 * 60 * 60 * 1000;

export default function App() {
  const [state, setState] = useState<ApiState>({ tasks: [], executions: [] });
  const [draft, setDraft] = useState<DraftTask>(() => createEmptyDraft(fallbackCwd));
  const [selectedTaskId, setSelectedTaskId] = useState<string>("new");
  const [openExecutionId, setOpenExecutionId] = useState<string | null>(null);
  const [daemonState, setDaemonState] = useState<DaemonState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [homeDir, setHomeDir] = useState(fallbackCwd);
  const [editorMode, setEditorMode] = useState<"edit" | "preview">("edit");
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [filter, setFilter] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");

  const [leftWidth, setLeftWidth] = useState(320);
  const [rightWidth, setRightWidth] = useState(380);
  const dragRef = useRef<{ side: "left" | "right"; startX: number; startW: number } | null>(null);

  const draftSourceRef = useRef<{ taskId: string | null; fingerprint: string | null }>({
    taskId: null,
    fingerprint: null
  });
  const filterInputRef = useRef<HTMLInputElement | null>(null);

  const selectedTask = useMemo(
    () => state.tasks.find((t) => t.id === selectedTaskId) ?? null,
    [selectedTaskId, state.tasks]
  );

  const selectedTaskExecutions = useMemo(
    () =>
      state.executions
        .filter((e) => selectedTask && e.taskId === selectedTask.id)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [state.executions, selectedTask]
  );

  const openExecution = useMemo(
    () => state.executions.find((e) => e.id === openExecutionId) ?? null,
    [state.executions, openExecutionId]
  );

  const selectedTaskRunningExecution = useMemo(
    () => (selectedTask ? findRunningExecution(state.executions, selectedTask.id) : null),
    [selectedTask, state.executions]
  );

  const isSelectedTaskRunning = Boolean(selectedTaskRunningExecution);

  const hasUnsavedChanges = useMemo(
    () =>
      Boolean(
        draft.id &&
          draftSourceRef.current.taskId === draft.id &&
          draftSourceRef.current.fingerprint !== null &&
          fingerprintDraft(draft) !== draftSourceRef.current.fingerprint
      ),
    [draft]
  );

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!openExecution || openExecution.status !== "running") return;
    const timer = window.setInterval(() => {
      void refreshExecution(openExecution.id);
    }, RUNNING_POLL_MS);
    void refreshExecution(openExecution.id);
    return () => window.clearInterval(timer);
  }, [openExecution?.id, openExecution?.status]);

  useEffect(() => {
    if (selectedTask) {
      setDraft((current) => {
        const next = taskToDraft(selectedTask);
        const nextFingerprint = fingerprintDraft(next);
        const hasLocalEdits =
          current.id === selectedTask.id &&
          draftSourceRef.current.taskId === selectedTask.id &&
          draftSourceRef.current.fingerprint !== null &&
          fingerprintDraft(current) !== draftSourceRef.current.fingerprint;
        if (hasLocalEdits) return current;
        draftSourceRef.current = { taskId: selectedTask.id, fingerprint: nextFingerprint };
        return next;
      });
      return;
    }
    if (selectedTaskId === "new") {
      draftSourceRef.current = { taskId: null, fingerprint: null };
      setDraft(createEmptyDraft(homeDir));
    }
  }, [homeDir, selectedTask, selectedTaskId]);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = event.clientX - dragRef.current.startX;
      if (dragRef.current.side === "left") {
        setLeftWidth(Math.min(480, Math.max(240, dragRef.current.startW + dx)));
      } else {
        setRightWidth(Math.min(640, Math.max(280, dragRef.current.startW - dx)));
      }
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const startNewTask = useCallback(() => {
    setSelectedTaskId("new");
    setOpenExecutionId(null);
    draftSourceRef.current = { taskId: null, fingerprint: null };
    setDraft(createEmptyDraft(homeDir));
  }, [homeDir]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        void saveDraft();
      } else if (key === "enter") {
        event.preventDefault();
        if (draft.id && !isRunning && !isSelectedTaskRunning) void runSelectedTask();
      } else if (key === "k") {
        event.preventDefault();
        filterInputRef.current?.focus();
      } else if (key === "n") {
        event.preventDefault();
        startNewTask();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.id, isRunning, isSelectedTaskRunning, startNewTask]);

  async function bootstrap(): Promise<void> {
    setError(null);
    try {
      const health = await api<{ ok: boolean; homeDir: string }>("/api/health");
      setHomeDir(health.homeDir);
      setDraft(createEmptyDraft(health.homeDir));
      setDaemonState("online");
      const [tasksResponse, executionsResponse] = await Promise.all([
        api<{ tasks: Task[] }>("/api/tasks"),
        api<{ executions: Execution[] }>("/api/executions")
      ]);
      const initialTaskId = tasksResponse.tasks[0]?.id ?? "new";
      setSelectedTaskId(initialTaskId);
      setState({ tasks: tasksResponse.tasks, executions: executionsResponse.executions });
    } catch (requestError) {
      setDaemonState("error");
      setError(toMessage(requestError));
    }
  }

  async function refresh(): Promise<void> {
    try {
      const [tasksResponse, executionsResponse] = await Promise.all([
        api<{ tasks: Task[] }>("/api/tasks"),
        api<{ executions: Execution[] }>("/api/executions")
      ]);
      setDaemonState("online");
      setState({ tasks: tasksResponse.tasks, executions: executionsResponse.executions });
      setError(null);
    } catch (requestError) {
      setDaemonState("error");
      setError(toMessage(requestError));
    }
  }

  async function refreshExecution(executionId: string): Promise<void> {
    try {
      const response = await api<{ execution: Execution }>(`/api/executions/${executionId}`);
      setState((current) => ({
        ...current,
        executions: mergeExecutionIntoList(current.executions, response.execution)
      }));
      if (response.execution.status !== "running") {
        void refresh();
      }
    } catch (requestError) {
      setError(toMessage(requestError));
    }
  }

  async function saveDraft(): Promise<void> {
    if (!draft.title.trim() || !draft.cwd.trim() || !draft.prompt.trim()) {
      setError("Title, working directory and prompt are required.");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const payload = normalizeDraft(draft);
      const response = draft.id
        ? await api<{ task: Task }>(`/api/tasks/${draft.id}`, {
            method: "PUT",
            body: JSON.stringify(payload)
          })
        : await api<{ task: Task }>("/api/tasks", {
            method: "POST",
            body: JSON.stringify(payload)
          });
      const savedDraft = taskToDraft(response.task);
      draftSourceRef.current = {
        taskId: response.task.id,
        fingerprint: fingerprintDraft(savedDraft)
      };
      setDraft(savedDraft);
      setSelectedTaskId(response.task.id);
      await refresh();
    } catch (requestError) {
      setError(toMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  }

  async function runSelectedTask(): Promise<void> {
    if (!draft.id) return;
    if (selectedTaskRunningExecution) {
      setOpenExecutionId(selectedTaskRunningExecution.id);
      return;
    }
    setIsRunning(true);
    setError(null);
    try {
      const response = await api<{ execution: Execution }>(`/api/tasks/${draft.id}/run`, {
        method: "POST"
      });
      setState((current) => ({
        ...current,
        executions: mergeExecutionIntoList(current.executions, response.execution)
      }));
      setOpenExecutionId(response.execution.id);
      await refresh();
    } catch (requestError) {
      setError(toMessage(requestError));
    } finally {
      setIsRunning(false);
    }
  }

  async function continueExecution(): Promise<void> {
    if (!openExecution || !isContinuableExecution(openExecution)) return;
    setIsResuming(true);
    setError(null);
    try {
      const response = await api<{ execution: Execution }>(
        `/api/executions/${openExecution.id}/resume`,
        { method: "POST" }
      );
      setState((current) => ({
        ...current,
        executions: mergeExecutionIntoList(current.executions, response.execution)
      }));
      setOpenExecutionId(response.execution.id);
      await refresh();
    } catch (requestError) {
      setError(toMessage(requestError));
    } finally {
      setIsResuming(false);
    }
  }

  async function deleteTask(taskId: string): Promise<void> {
    setError(null);
    try {
      await api(`/api/tasks/${taskId}`, { method: "DELETE" });
      setPendingDelete(null);
      if (selectedTaskId === taskId) {
        startNewTask();
      }
      await refresh();
    } catch (requestError) {
      setError(toMessage(requestError));
    }
  }

  async function copyExecutionOutput(): Promise<void> {
    if (!openExecution) return;
    try {
      await navigator.clipboard.writeText(buildLogText(openExecution));
      setCopyStatus("copied");
      setTimeout(() => setCopyStatus("idle"), 1600);
    } catch {
      setError("Could not copy to clipboard.");
    }
  }

  function selectTask(task: Task) {
    setSelectedTaskId(task.id);
    setOpenExecutionId(null);
  }

  function startResize(side: "left" | "right") {
    return (event: React.MouseEvent) => {
      dragRef.current = {
        side,
        startX: event.clientX,
        startW: side === "left" ? leftWidth : rightWidth
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      event.preventDefault();
    };
  }

  const filteredTasks = useMemo(() => {
    if (!filter.trim()) return state.tasks;
    const query = filter.trim().toLowerCase();
    return state.tasks.filter(
      (t) => t.title.toLowerCase().includes(query) || t.cwd.toLowerCase().includes(query)
    );
  }, [filter, state.tasks]);

  const runningCount = useMemo(
    () =>
      new Set(
        state.executions.filter((e) => e.status === "running").map((e) => e.taskId)
      ).size,
    [state.executions]
  );
  const scheduledCount = useMemo(
    () => state.tasks.filter((t) => t.enabled && t.schedule.type !== "manual").length,
    [state.tasks]
  );

  const ribbonTicks = useMemo(() => buildRibbonTicks(state.tasks, state.executions), [state.tasks, state.executions]);
  const nextRunRelative = useMemo(() => nearestNextRunFromTasks(state.tasks), [state.tasks]);

  const workspaceStyle: CSSProperties = {
    gridTemplateColumns: `${leftWidth}px 1px 1fr 1px ${rightWidth}px`
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true" />
          <div className="brand-name">
            Codex Routines
            <span className="dot" />
            <span className="sub">local automation</span>
          </div>
        </div>
        <Ribbon ticks={ribbonTicks} nextLabel={nextRunRelative} />
        <div className="top-actions">
          {error ? (
            <span className="error-pill" title={error}>
              {error}
            </span>
          ) : (
            <>
              <span className="pill">
                <span className="num">{runningCount}</span>running
              </span>
              <span className="pill">
                <span className="num">{scheduledCount}</span>scheduled
              </span>
              <span className="pill">
                <span style={{ color: "var(--muted)" }}>refresh</span>
                <span className="num">{REFRESH_MS / 1000}s</span>
              </span>
            </>
          )}
        </div>
      </header>

      <div className="workspace" style={workspaceStyle}>
        <aside className="tasks" aria-label="Tasks">
          <div className="tasks-head">
            <h2>
              Tasks <span className="count">{state.tasks.length}</span>
            </h2>
            <button
              className="icon-btn primary"
              type="button"
              title="New routine (Ctrl/Cmd+N)"
              onClick={startNewTask}
            >
              <Plus size={15} />
            </button>
          </div>
          <div className="tasks-search">
            <Search size={14} />
            <input
              ref={filterInputRef}
              placeholder="Filter routines..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter routines"
            />
            <span className="kbd">⌘K</span>
          </div>
          <div className="task-list">
            {filteredTasks.length === 0 ? (
              <div className="task-list-empty">
                {state.tasks.length === 0 ? "No routines yet. Press + to create one." : "No matches."}
              </div>
            ) : (
              filteredTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  selected={task.id === selectedTaskId}
                  onSelect={() => selectTask(task)}
                  onDelete={() => setPendingDelete(task.id)}
                  pendingDelete={pendingDelete === task.id}
                  onCancelDelete={() => setPendingDelete(null)}
                  onConfirmDelete={() => void deleteTask(task.id)}
                  history={recentExecutionStatuses(state.executions, task.id)}
                  isRunning={isTaskRunning(state.executions, task.id)}
                />
              ))
            )}
          </div>
        </aside>

        <div className="resizer" onMouseDown={startResize("left")} />

        <main className="editor" aria-label="Editor">
          <div className="editor-head">
            <div className="editor-crumb">
              <span>routine</span>
              <span className="dot">/</span>
              <span style={{ color: "var(--ink-2)" }}>{draft.title || "Untitled"}</span>
              {isSelectedTaskRunning && (
                <>
                  <span className="dot">·</span>
                  <span className="live">● live</span>
                </>
              )}
              {hasUnsavedChanges && (
                <>
                  <span className="dot">·</span>
                  <span className="unsaved">unsaved</span>
                </>
              )}
            </div>
            <div className="editor-title-row">
              <h1 className="editor-title">
                <input
                  aria-label="Name"
                  value={draft.title}
                  onChange={(e) =>
                    setDraft((current) => ({ ...current, title: e.target.value }))
                  }
                  placeholder="Untitled routine"
                />
              </h1>
              <div className="editor-actions">
                <button
                  className={`toggle-active ${draft.enabled ? "on" : ""}`}
                  type="button"
                  onClick={() =>
                    setDraft((current) => ({ ...current, enabled: !current.enabled }))
                  }
                  title={draft.enabled ? "Active — click to pause" : "Paused — click to activate"}
                >
                  <span className="switch" />
                  {draft.enabled ? "Active" : "Paused"}
                </button>
                {draft.id ? (
                  pendingDelete === draft.id ? (
                    <>
                      <button
                        className="btn"
                        type="button"
                        onClick={() => setPendingDelete(null)}
                      >
                        Cancel
                      </button>
                      <button
                        className="btn danger"
                        type="button"
                        onClick={() => void deleteTask(draft.id as string)}
                      >
                        <Trash2 size={14} /> Confirm delete
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn danger"
                      type="button"
                      onClick={() => setPendingDelete(draft.id as string)}
                      title="Delete this routine"
                    >
                      <Trash2 size={14} />
                    </button>
                  )
                ) : null}
                <button
                  className="btn"
                  type="button"
                  disabled={!draft.id || isRunning || isSelectedTaskRunning}
                  onClick={() => void runSelectedTask()}
                  title="Run now (Ctrl/Cmd+Enter)"
                >
                  {isRunning || isSelectedTaskRunning ? (
                    <Loader2 size={14} className="btn-spinner" />
                  ) : (
                    <Play size={14} />
                  )}
                  {isSelectedTaskRunning ? "Running" : "Run"}
                  <span className="kbd">⌘↩</span>
                </button>
                <button
                  className="btn primary"
                  type="button"
                  disabled={isSaving}
                  onClick={() => void saveDraft()}
                  title="Save (Ctrl/Cmd+S)"
                >
                  {isSaving ? <Loader2 size={14} className="btn-spinner" /> : <Save size={14} />}
                  Save
                  <span
                    className="kbd"
                    style={{
                      background: "var(--cyan-2)",
                      borderColor: "var(--cyan-2)",
                      color: "var(--cyan-ink)"
                    }}
                  >
                    ⌘S
                  </span>
                </button>
              </div>
            </div>

            <div className="meta">
              <div>
                <span className="meta-label">Status</span>
                <span
                  className={`meta-value ${
                    isSelectedTaskRunning ? "cyan" : draft.enabled ? "" : "muted"
                  }`}
                >
                  {isSelectedTaskRunning ? "Running" : draft.enabled ? "Active" : "Paused"}
                </span>
              </div>
              <div>
                <span className="meta-label">Next run</span>
                <span className="meta-value">
                  {isSelectedTaskRunning
                    ? "now"
                    : selectedTask?.nextRunAt
                      ? formatNextRun(selectedTask.nextRunAt)
                      : "—"}
                </span>
              </div>
              <div>
                <span className="meta-label">Last run</span>
                <span className="meta-value">
                  {selectedTask?.lastRunAt ? formatRelative(selectedTask.lastRunAt) : "never"}
                </span>
              </div>
              <div>
                <span className="meta-label">Path</span>
                <span className="meta-value mono" title={draft.cwd}>
                  {prettyPath(draft.cwd, homeDir)}
                </span>
              </div>
            </div>
          </div>

          <form className="editor-body" onSubmit={(e: FormEvent) => e.preventDefault()}>
            <div className="section">
              <div className="section-head">
                <span>Execution path</span>
                <span className="hint">where codex runs</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="field-input mono"
                  value={draft.cwd}
                  onChange={(e) =>
                    setDraft((current) => ({ ...current, cwd: e.target.value }))
                  }
                  placeholder="/absolute/path/to/repo"
                  spellCheck={false}
                />
                <button
                  className="btn"
                  type="button"
                  title="Use home directory"
                  onClick={() => setDraft((current) => ({ ...current, cwd: homeDir }))}
                >
                  <Folder size={14} />
                </button>
              </div>
            </div>

            <div className="section">
              <div className="section-head">
                <span>Schedule</span>
                <span className="hint">when this routine runs</span>
              </div>
              <ScheduleBuilder
                schedule={draft.schedule}
                onChange={(schedule) => setDraft((current) => ({ ...current, schedule }))}
              />
            </div>

            <div className="section">
              <div className="section-head">
                <span>Prompt</span>
                <span className="hint">markdown · interpreted by codex</span>
              </div>
              <div className="prompt">
                <div className="prompt-toolbar">
                  <div className="prompt-tabs">
                    <button
                      type="button"
                      className={editorMode === "edit" ? "active" : ""}
                      onClick={() => setEditorMode("edit")}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={editorMode === "preview" ? "active" : ""}
                      onClick={() => setEditorMode("preview")}
                    >
                      Preview
                    </button>
                  </div>
                  <div className="prompt-meta">
                    <FileText size={12} />
                    <span>md</span>
                    <span>·</span>
                    <span>{draft.prompt.length} chars</span>
                    <span>·</span>
                    <span>{draft.prompt.split("\n").length} lines</span>
                  </div>
                </div>
                {editorMode === "edit" ? (
                  <textarea
                    value={draft.prompt}
                    spellCheck={false}
                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                      setDraft((current) => ({ ...current, prompt: e.target.value }))
                    }
                  />
                ) : (
                  <div className="prompt-preview">
                    {draft.prompt.trim() ? (
                      <ReactMarkdown>{draft.prompt}</ReactMarkdown>
                    ) : (
                      <span className="empty">Empty prompt.</span>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="danger-row">
              <Zap size={14} />
              runs as <code>codex exec --dangerously-bypass-approvals-and-sandbox</code> in the path above
            </div>
          </form>
        </main>

        <div className="resizer" onMouseDown={startResize("right")} />

        <aside className="logs" aria-label="Runs">
          <div className="logs-head">
            <h2>
              Runs <span className="count">{selectedTaskExecutions.length}</span>
            </h2>
            {selectedTask && <span className="task-name">{selectedTask.title}</span>}
          </div>
          <div className="logs-body">
            {!selectedTask ? (
              <div className="logs-empty">Save a routine to see its runs.</div>
            ) : selectedTaskExecutions.length === 0 ? (
              <div className="logs-empty">No runs yet for this routine.</div>
            ) : (
              selectedTaskExecutions.map((exec) => (
                <RunRow
                  key={exec.id}
                  execution={exec}
                  onOpen={() => setOpenExecutionId(exec.id)}
                />
              ))
            )}
          </div>
        </aside>
      </div>

      {openExecution && (
        <ExecutionModal
          execution={openExecution}
          taskTitle={selectedTask?.title ?? openExecution.taskTitle}
          onClose={() => setOpenExecutionId(null)}
          onCopy={() => void copyExecutionOutput()}
          copyStatus={copyStatus}
          onContinue={() => void continueExecution()}
          isResuming={isResuming}
        />
      )}

      <footer className="statusbar">
        <span className={`seg ${daemonState === "error" ? "error" : ""}`}>
          <span className="dot" />
          {daemonState === "online"
            ? "daemon online"
            : daemonState === "loading"
              ? "connecting"
              : "daemon offline"}
        </span>
        <span className="seg">refresh {REFRESH_MS / 1000}s</span>
        <span className="seg path" title={homeDir}>
          home: {prettyPath(homeDir, homeDir)}
        </span>
        <span className="right seg">⌘K filter · ⌘N new · ⌘↩ run · ⌘S save</span>
      </footer>
    </div>
  );
}

/* ----------------------------- task row ----------------------------- */

function TaskRow(props: {
  task: Task;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  pendingDelete: boolean;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  history: ExecutionStatus[];
  isRunning: boolean;
}) {
  const { task, selected, onSelect, onDelete, pendingDelete, onCancelDelete, onConfirmDelete, history, isRunning } =
    props;
  const status: TaskOrbStatus = isRunning ? "running" : !task.enabled ? "paused" : "waiting";
  const minutes = task.nextRunAt ? minutesUntil(task.nextRunAt) : null;
  const countdown = isRunning
    ? "running…"
    : !task.enabled
      ? "paused"
      : task.schedule.type === "manual"
        ? "manual"
        : minutes !== null
          ? formatMinutes(minutes)
          : "—";

  return (
    <div
      className={`task ${selected ? "selected" : ""} ${status}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="task-row1">
        <span className={`status-orb ${status}`} aria-hidden="true" />
        <span className="task-title">{task.title}</span>
      </div>
      <div className="task-row2">
        <span className="schedule-chip">{shortSchedule(task.schedule)}</span>
        <Sparkline statuses={history} />
        <span
          className={`task-countdown ${
            minutes !== null && minutes <= 5 && !isRunning ? "imminent" : ""
          }`}
        >
          {countdown}
        </span>
      </div>
      <div className="task-actions">
        <button
          className="task-action"
          type="button"
          title={`Delete ${task.title}`}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 size={12} />
        </button>
      </div>
      {pendingDelete && (
        <div className="task-confirm" onClick={(e) => e.stopPropagation()}>
          <span className="task-confirm-msg">Delete this routine?</span>
          <button className="task-confirm-btn" type="button" onClick={onCancelDelete}>
            Cancel
          </button>
          <button className="task-confirm-btn danger" type="button" onClick={onConfirmDelete}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

type TaskOrbStatus = "running" | "waiting" | "paused" | "failed";

function Sparkline({ statuses }: { statuses: ExecutionStatus[] }) {
  const padded = [...statuses];
  while (padded.length < SPARKLINE_LIMIT) padded.unshift("idle" as ExecutionStatus);
  return (
    <span className="sparkline" aria-label="recent runs">
      {padded.map((status, i) => (
        <span
          key={i}
          className={status}
          style={{ height: `${6 + ((i % 4) * 1.5)}px` }}
        />
      ))}
    </span>
  );
}

/* ----------------------------- ribbon ----------------------------- */

type RibbonTick = { pct: number; kind: "lime" | "warn" | "muted"; label: string };

function Ribbon({ ticks, nextLabel }: { ticks: RibbonTick[]; nextLabel: string | null }) {
  return (
    <div className="ribbon">
      <span className="ribbon-label">Next 24h</span>
      <div className="ribbon-track">
        <div className="ribbon-now" style={{ left: "0%" }} />
        {ticks.map((t, i) => (
          <span
            key={i}
            className={`ribbon-tick ${t.kind}`}
            style={{ left: `${t.pct}%` }}
            title={t.label}
          />
        ))}
      </div>
      {nextLabel && (
        <span className="ribbon-label" style={{ color: "var(--cyan)" }}>
          · next {nextLabel}
        </span>
      )}
    </div>
  );
}

/* ----------------------------- schedule builder ----------------------------- */

const scheduleModes: Array<{ id: TaskSchedule["type"]; label: string; ico: string }> = [
  { id: "manual", label: "Manual", ico: "⌘" },
  { id: "interval", label: "Interval", ico: "↻" },
  { id: "daily", label: "Daily", ico: "☀" },
  { id: "weekly", label: "Weekly", ico: "▦" },
  { id: "once", label: "Once", ico: "•" },
  { id: "cron", label: "Cron", ico: "{ }" }
];

function ScheduleBuilder(props: {
  schedule: TaskSchedule;
  onChange: (schedule: TaskSchedule) => void;
}) {
  const { schedule, onChange } = props;

  const previewItems = useMemo(() => computeNextRunPreview(schedule, 6), [schedule]);

  return (
    <div className="sched">
      <div className="sched-modes" role="tablist">
        {scheduleModes.map((mode) => (
          <button
            key={mode.id}
            type="button"
            role="tab"
            aria-selected={schedule.type === mode.id}
            className={schedule.type === mode.id ? "active" : ""}
            onClick={() => onChange(defaultSchedule(mode.id))}
          >
            <span className="ico">{mode.ico}</span>
            {mode.label}
          </button>
        ))}
      </div>
      <div className="sched-body">
        <div className="sched-summary">
          <span className="lead">Runs</span>
          {schedule.type === "manual" && (
            <span className="phrase">
              only when you press <span className="accent">Run</span>.
            </span>
          )}
          {schedule.type === "interval" && (
            <>
              <span className="phrase">every</span>
              <span className="phrase-pill">
                <input
                  type="number"
                  min={1}
                  value={schedule.everyMinutes}
                  onChange={(e) =>
                    onChange({
                      type: "interval",
                      everyMinutes: Math.max(1, Number(e.target.value) || 1)
                    })
                  }
                />
                <span style={{ color: "var(--muted)" }}>min</span>
              </span>
              <span className="phrase">around the clock.</span>
            </>
          )}
          {schedule.type === "daily" && (
            <>
              <span className="phrase">every day at</span>
              <span className="phrase-pill">
                <input
                  type="time"
                  value={schedule.time}
                  onChange={(e) => onChange({ type: "daily", time: e.target.value || "09:00" })}
                />
              </span>
            </>
          )}
          {schedule.type === "weekly" && (
            <>
              <span className="phrase">every</span>
              <span className="phrase-pill">
                <select
                  value={String(schedule.dayOfWeek)}
                  onChange={(e) =>
                    onChange({ type: "weekly", dayOfWeek: Number(e.target.value), time: schedule.time })
                  }
                >
                  {weekdayLabels.map((d, i) => (
                    <option key={i} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </span>
              <span className="phrase">at</span>
              <span className="phrase-pill">
                <input
                  type="time"
                  value={schedule.time}
                  onChange={(e) =>
                    onChange({ type: "weekly", dayOfWeek: schedule.dayOfWeek, time: e.target.value || "09:00" })
                  }
                />
              </span>
            </>
          )}
          {schedule.type === "once" && (
            <>
              <span className="phrase">once at</span>
              <span className="phrase-pill">
                <input
                  type="datetime-local"
                  value={schedule.runAt}
                  onChange={(e) => onChange({ type: "once", runAt: e.target.value })}
                />
              </span>
            </>
          )}
          {schedule.type === "cron" && (
            <>
              <span className="phrase">on cron</span>
              <span className="phrase-pill">
                <input
                  style={{ width: "14ch", color: "var(--cyan)", textAlign: "left" }}
                  value={schedule.expression}
                  onChange={(e) => onChange({ type: "cron", expression: e.target.value })}
                />
              </span>
              <span className="phrase" style={{ color: "var(--muted)" }}>
                · {humanizeCron(schedule.expression)}
              </span>
            </>
          )}
        </div>

        {previewItems.length > 0 && (
          <div className="next-runs">
            <span className="next-runs-label">Next runs</span>
            <div className="next-runs-track">
              {previewItems.map((p, i) => (
                <div key={i} className={`next-runs-tick ${i === 0 ? "next" : "future"}`}>
                  <span className="dot" />
                  <span className="label">{p}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* ----------------------------- run row + modal ----------------------------- */

function RunRow({ execution, onOpen }: { execution: Execution; onOpen: () => void }) {
  const orbClass =
    execution.status === "success"
      ? "success"
      : execution.status === "failed"
        ? "failed"
        : execution.status === "stale"
          ? "stale"
          : "running";

  const meta =
    execution.status === "running"
      ? "running now"
      : execution.status === "success"
        ? "succeeded"
        : execution.status === "failed"
          ? "failed"
          : "stale";

  return (
    <div
      className="run-row"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <span className={`status-orb ${orbClass}`} aria-hidden="true" />
      <span>
        <div className="when">{formatTime(execution.startedAt)}</div>
        <div className="meta-line">{meta}</div>
      </span>
      <span className="duration">{describeDuration(execution)}</span>
    </div>
  );
}

function ExecutionModal(props: {
  execution: Execution;
  taskTitle: string;
  onClose: () => void;
  onCopy: () => void;
  copyStatus: "idle" | "copied";
  onContinue: () => void;
  isResuming: boolean;
}) {
  const { execution, taskTitle, onClose, onCopy, copyStatus, onContinue, isResuming } = props;
  const continuable = isContinuableExecution(execution);
  const orbClass =
    execution.status === "success"
      ? "success"
      : execution.status === "failed"
        ? "failed"
        : execution.status === "stale"
          ? "stale"
          : "running";

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">
              <span className={`status-orb ${orbClass}`} aria-hidden="true" />
              Run · {formatDateTime(execution.startedAt)}
              {execution.status === "running" && <span className="live">● live</span>}
            </div>
            <div className="modal-sub">
              {taskTitle} · {describeDuration(execution)}{" "}
              {execution.exitCode !== null ? `· exit ${execution.exitCode}` : ""}
            </div>
          </div>
          <div className="modal-actions">
            {continuable && (
              <button
                className="btn primary"
                type="button"
                disabled={isResuming}
                onClick={onContinue}
              >
                {isResuming ? <Loader2 size={14} className="btn-spinner" /> : <RotateCcw size={14} />}
                Continue
              </button>
            )}
            <button className="btn" type="button" onClick={onCopy}>
              {copyStatus === "copied" ? <Check size={14} /> : <Copy size={14} />}
              {copyStatus === "copied" ? "Copied" : "Copy"}
            </button>
            <button className="icon-btn" type="button" onClick={onClose} title="Close (Esc)">
              <X size={14} />
            </button>
          </div>
        </div>
        {(execution.status === "stale" || continuable) && (
          <div className="modal-recovery">
            <AlertTriangle size={16} />
            <div className="recovery-body">
              <strong>Execution may be stuck</strong>
              {continuable && execution.resumeSessionId ? (
                <span>
                  The platform is no longer tracking this process. Continue resumes the Codex session{" "}
                  <code>{execution.resumeSessionId}</code> in a new tracked execution.
                </span>
              ) : (
                <span>
                  The platform is no longer tracking this process. Run the task again if you need to restart.
                </span>
              )}
            </div>
          </div>
        )}
        <pre className="modal-output">{renderExecutionOutput(execution)}</pre>
      </div>
    </div>
  );
}

function renderExecutionOutput(execution: Execution): ReactNode {
  return (
    <>
      <span className="l-cmd">$ {execution.command.join(" ")}</span>
      {"\n"}
      <span className="l-dim">cwd: {execution.cwd}</span>
      {"\n\n"}
      <span className="l-section">[stdout]</span>
      {"\n"}
      {execution.stdout || (execution.status === "running" ? <span className="l-dim">waiting for codex output...</span> : <span className="l-dim">(empty)</span>)}
      {execution.stderr && (
        <>
          {"\n\n"}
          <span className="l-section">[stderr]</span>
          {"\n"}
          <span className="l-warn">{execution.stderr}</span>
        </>
      )}
      {execution.error && (
        <>
          {"\n\n"}
          <span className="l-section">[error]</span>
          {"\n"}
          <span className="l-err">{execution.error}</span>
        </>
      )}
    </>
  );
}

/* ----------------------------- helpers ----------------------------- */

function createEmptyDraft(cwd: string): DraftTask {
  return {
    title: "New Codex routine",
    prompt: "# Goal\n\n",
    cwd,
    enabled: true,
    schedule: { type: "manual" }
  };
}

function taskToDraft(task: Task): DraftTask {
  return {
    id: task.id,
    title: task.title,
    prompt: task.prompt,
    cwd: task.cwd,
    enabled: task.enabled,
    schedule: task.schedule
  };
}

function defaultSchedule(type: TaskSchedule["type"]): TaskSchedule {
  if (type === "manual") return { type };
  if (type === "interval") return { type, everyMinutes: 60 };
  if (type === "daily") return { type, time: "09:00" };
  if (type === "weekly") return { type, dayOfWeek: 1, time: "09:00" };
  if (type === "once") return { type, runAt: toDatetimeLocal(new Date(Date.now() + 60 * 60_000)) };
  return { type, expression: "0 9 * * *" };
}

function normalizeDraft(draft: DraftTask): CreateTaskInput {
  return {
    title: draft.title,
    prompt: draft.prompt,
    cwd: draft.cwd,
    schedule: draft.schedule,
    enabled: draft.enabled
  };
}

function fingerprintDraft(draft: DraftTask): string {
  return JSON.stringify(normalizeDraft(draft));
}

function shortSchedule(schedule: TaskSchedule): string {
  switch (schedule.type) {
    case "manual":
      return "Manual";
    case "interval":
      return `Every ${schedule.everyMinutes}m`;
    case "daily":
      return `Daily ${schedule.time}`;
    case "weekly":
      return `${weekdayLabels[schedule.dayOfWeek]} ${schedule.time}`;
    case "once":
      return `Once`;
    case "cron":
      return `Cron ${schedule.expression}`;
  }
}

function humanizeCron(expression: string): string {
  try {
    const cron = new Cron(expression);
    const next = cron.nextRun();
    if (!next) return "no upcoming run";
    return `next ${formatRelative(next.toISOString())}`;
  } catch {
    return "invalid cron";
  }
}

function computeNextRunPreview(schedule: TaskSchedule, count: number): string[] {
  const now = Date.now();
  if (schedule.type === "manual") return [];
  if (schedule.type === "once") {
    if (!schedule.runAt) return ["set time"];
    const date = new Date(schedule.runAt);
    return [formatRelative(date.toISOString())];
  }
  if (schedule.type === "interval") {
    return Array.from({ length: count }, (_, i) =>
      formatRelative(new Date(now + (i + 1) * schedule.everyMinutes * 60_000).toISOString())
    );
  }
  if (schedule.type === "daily") {
    return computeFromDailyTime(schedule.time, count);
  }
  if (schedule.type === "weekly") {
    return computeFromWeeklyTime(schedule.dayOfWeek, schedule.time, count);
  }
  if (schedule.type === "cron") {
    try {
      const cron = new Cron(schedule.expression);
      const items: string[] = [];
      let cursor: Date | null = new Date(now);
      for (let i = 0; i < count; i++) {
        const next = cron.nextRun(cursor as Date);
        if (!next) break;
        items.push(formatRelative(next.toISOString()));
        cursor = next;
      }
      return items;
    } catch {
      return [];
    }
  }
  return [];
}

function computeFromDailyTime(time: string, count: number): string[] {
  const [hh, mm] = time.split(":").map(Number);
  const items: string[] = [];
  const base = new Date();
  base.setHours(hh, mm, 0, 0);
  if (base.getTime() <= Date.now()) base.setDate(base.getDate() + 1);
  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    items.push(formatRelative(d.toISOString()));
  }
  return items;
}

function computeFromWeeklyTime(dayOfWeek: number, time: string, count: number): string[] {
  const [hh, mm] = time.split(":").map(Number);
  const now = new Date();
  const base = new Date(now);
  const delta = (dayOfWeek - now.getDay() + 7) % 7;
  base.setDate(now.getDate() + delta);
  base.setHours(hh, mm, 0, 0);
  if (base.getTime() <= Date.now()) base.setDate(base.getDate() + 7);
  const items: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i * 7);
    items.push(formatRelative(d.toISOString()));
  }
  return items;
}

function isTaskRunning(executions: Execution[], taskId: string): boolean {
  return executions.some((e) => e.taskId === taskId && e.status === "running");
}

function recentExecutionStatuses(executions: Execution[], taskId: string): ExecutionStatus[] {
  return executions
    .filter((e) => e.taskId === taskId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, SPARKLINE_LIMIT)
    .reverse()
    .map((e) => e.status);
}

function buildRibbonTicks(tasks: Task[], executions: Execution[]): RibbonTick[] {
  const now = Date.now();
  const horizon = now + RIBBON_HORIZON_MS;
  const ticks: RibbonTick[] = [];
  for (const task of tasks) {
    if (!task.enabled) continue;
    if (task.schedule.type === "manual") continue;
    const lastFailed = recentExecutionStatuses(executions, task.id).slice(-1)[0] === "failed";
    const upcoming = nextRunsForTask(task, 5).filter((d) => d.getTime() > now && d.getTime() <= horizon);
    for (const d of upcoming) {
      const pct = ((d.getTime() - now) / RIBBON_HORIZON_MS) * 100;
      ticks.push({
        pct: Math.max(0, Math.min(100, pct)),
        kind: lastFailed ? "warn" : "lime",
        label: `${task.title} · ${formatTime(d.toISOString())}`
      });
    }
  }
  for (const exec of executions) {
    if (exec.status !== "running") continue;
    ticks.push({ pct: 0, kind: "warn", label: `${exec.taskTitle} · running` });
  }
  return ticks;
}

function nextRunsForTask(task: Task, count: number): Date[] {
  const items: Date[] = [];
  const now = Date.now();
  const schedule = task.schedule;
  if (schedule.type === "manual") return items;
  if (schedule.type === "once") {
    const d = new Date(schedule.runAt);
    if (d.getTime() > now) items.push(d);
    return items;
  }
  if (schedule.type === "interval") {
    const startMs = task.nextRunAt ? new Date(task.nextRunAt).getTime() : now + schedule.everyMinutes * 60_000;
    for (let i = 0; i < count; i++) {
      items.push(new Date(startMs + i * schedule.everyMinutes * 60_000));
    }
    return items;
  }
  if (schedule.type === "daily") {
    const [hh, mm] = schedule.time.split(":").map(Number);
    const base = new Date();
    base.setHours(hh, mm, 0, 0);
    if (base.getTime() <= now) base.setDate(base.getDate() + 1);
    for (let i = 0; i < count; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      items.push(d);
    }
    return items;
  }
  if (schedule.type === "weekly") {
    const [hh, mm] = schedule.time.split(":").map(Number);
    const cursor = new Date();
    const delta = (schedule.dayOfWeek - cursor.getDay() + 7) % 7;
    cursor.setDate(cursor.getDate() + delta);
    cursor.setHours(hh, mm, 0, 0);
    if (cursor.getTime() <= now) cursor.setDate(cursor.getDate() + 7);
    for (let i = 0; i < count; i++) {
      const d = new Date(cursor);
      d.setDate(cursor.getDate() + i * 7);
      items.push(d);
    }
    return items;
  }
  if (schedule.type === "cron") {
    try {
      const cron = new Cron(schedule.expression);
      let cursor: Date | null = new Date(now);
      for (let i = 0; i < count; i++) {
        const next: Date | null = cron.nextRun(cursor as Date);
        if (!next) break;
        items.push(next);
        cursor = next;
      }
    } catch {
      // ignore invalid expressions
    }
    return items;
  }
  return items;
}

function nearestNextRunFromTasks(tasks: Task[]): string | null {
  const now = Date.now();
  let nearest: number | null = null;
  for (const task of tasks) {
    if (!task.enabled || !task.nextRunAt) continue;
    const t = new Date(task.nextRunAt).getTime();
    if (t < now) continue;
    if (nearest === null || t < nearest) nearest = t;
  }
  if (nearest === null) return null;
  return formatRelative(new Date(nearest).toISOString());
}

function minutesUntil(iso: string): number {
  return Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
}

function formatMinutes(m: number): string {
  if (m <= 0) return "now";
  if (m < 60) return `in ${m}m`;
  if (m < 1440) {
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return rest ? `in ${h}h ${rest}m` : `in ${h}h`;
  }
  const d = Math.floor(m / 1440);
  const restH = Math.floor((m % 1440) / 60);
  return restH ? `in ${d}d ${restH}h` : `in ${d}d`;
}

function formatRelative(iso: string): string {
  const date = new Date(iso);
  const diffMs = date.getTime() - Date.now();
  const absMin = Math.round(Math.abs(diffMs) / 60_000);
  const future = diffMs >= 0;
  if (absMin < 1) return future ? "in <1m" : "just now";
  if (absMin < 60) return future ? `in ${absMin}m` : `${absMin}m ago`;
  const absH = Math.round(absMin / 60);
  if (absH < 48) return future ? `in ${absH}h` : `${absH}h ago`;
  const absD = Math.round(absH / 24);
  return future ? `in ${absD}d` : `${absD}d ago`;
}

function formatNextRun(iso: string): string {
  const date = new Date(iso);
  return `${formatTime(iso)} · ${formatRelative(date.toISOString())}`;
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(iso));
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(iso));
}

function describeDuration(execution: Execution): string {
  if (execution.status === "running") return "live";
  if (!execution.finishedAt) return "—";
  const diffMs = new Date(execution.finishedAt).getTime() - new Date(execution.startedAt).getTime();
  const totalSec = Math.max(0, Math.round(diffMs / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

function prettyPath(path: string, home: string): string {
  if (home && path.startsWith(home)) return "~" + path.slice(home.length);
  return path;
}

function toDatetimeLocal(date: Date): string {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

function buildLogText(execution: Execution): string {
  const command = `$ ${execution.command.join(" ")}`;
  const error = execution.error ? `\n\n[error]\n${execution.error}` : "";
  const stderr = execution.stderr ? `\n\n[stderr]\n${execution.stderr}` : "";
  const empty = execution.status === "running" ? "waiting for codex output..." : "";
  const stdout = `\n\n[stdout]\n${execution.stdout || empty}`;
  return `${command}\n\ncwd: ${execution.cwd}${stdout}${stderr}${error}`;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers
    }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? `HTTP ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
