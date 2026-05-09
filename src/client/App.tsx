import { useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import ReactMarkdown from "react-markdown";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  Clock3,
  Database,
  FileText,
  Loader2,
  Play,
  Plus,
  Power,
  PowerOff,
  RotateCcw,
  Save,
  Terminal,
  Trash2,
  X
} from "lucide-react";
import { findRunningExecution, isContinuableExecution, mergeExecutionIntoList, resolveExecutionSelection } from "./executionState";
import type { CreateTaskInput, Execution, Task, TaskSchedule } from "../server/types";

type DraftTask = CreateTaskInput & {
  id?: string;
};

type ApiState = {
  tasks: Task[];
  executions: Execution[];
};

const fallbackCwd = "/";

const scheduleOptions: Array<{ type: TaskSchedule["type"]; label: string }> = [
  { type: "manual", label: "Manual" },
  { type: "once", label: "Once" },
  { type: "interval", label: "Interval" },
  { type: "daily", label: "Daily" },
  { type: "weekly", label: "Weekly" },
  { type: "cron", label: "Cron" }
];

const weekdays = [
  ["0", "Sunday"],
  ["1", "Monday"],
  ["2", "Tuesday"],
  ["3", "Wednesday"],
  ["4", "Thursday"],
  ["5", "Friday"],
  ["6", "Saturday"]
];

export default function App() {
  const [state, setState] = useState<ApiState>({ tasks: [], executions: [] });
  const [draft, setDraft] = useState<DraftTask>(() => createEmptyDraft(fallbackCwd));
  const [selectedTaskId, setSelectedTaskId] = useState<string>("new");
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [homeDir, setHomeDir] = useState(fallbackCwd);
  const [editorMode, setEditorMode] = useState<"edit" | "preview">("edit");
  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ taskId: string; source: "editor" | "sidebar" } | null>(null);
  const logPreRef = useRef<HTMLPreElement | null>(null);
  const shouldStickToLogEndRef = useRef(true);
  const draftSourceRef = useRef<{ taskId: string | null; fingerprint: string | null }>({
    taskId: null,
    fingerprint: null
  });

  const selectedTask = useMemo(
    () => state.tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, state.tasks]
  );

  const selectedExecution = useMemo(
    () => state.executions.find((execution) => execution.id === selectedExecutionId) ?? state.executions[0] ?? null,
    [selectedExecutionId, state.executions]
  );

  const selectedTaskRunningExecution = useMemo(
    () => (selectedTask ? findRunningExecution(state.executions, selectedTask.id) : null),
    [selectedTask, state.executions]
  );
  const isSelectedTaskRunning = Boolean(selectedTaskRunningExecution);
  const canContinueSelectedExecution = isContinuableExecution(selectedExecution);
  const selectedExecutionNeedsRecovery = selectedExecution?.status === "stale" || canContinueSelectedExecution;
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
      void refresh(false, selectedTaskId);
    }, 4_000);

    return () => window.clearInterval(timer);
  }, [selectedTaskId]);

  useEffect(() => {
    if (!selectedExecution || selectedExecution.status !== "running") return;

    const timer = window.setInterval(() => {
      void refreshExecution(selectedExecution.id);
    }, 1_200);

    void refreshExecution(selectedExecution.id);

    return () => window.clearInterval(timer);
  }, [selectedExecution?.id, selectedExecution?.status, selectedTaskId]);

  useEffect(() => {
    if (!isLogsOpen || !selectedTaskRunningExecution) return;

    setSelectedExecutionId((current) => current ?? selectedTaskRunningExecution.id);
  }, [isLogsOpen, selectedTaskRunningExecution?.id]);

  useEffect(() => {
    shouldStickToLogEndRef.current = true;
  }, [selectedExecution?.id]);

  useEffect(() => {
    const logPre = logPreRef.current;
    if (!logPre || !shouldStickToLogEndRef.current) return;

    logPre.scrollTop = logPre.scrollHeight;
  }, [selectedExecution?.stdout, selectedExecution?.stderr, selectedExecution?.error, selectedExecution?.status]);

  useEffect(() => {
    if (selectedTask) {
      setDraft((current) => {
        const nextDraft = taskToDraft(selectedTask);
        const nextFingerprint = fingerprintDraft(nextDraft);
        const hasLocalEdits =
          current.id === selectedTask.id &&
          draftSourceRef.current.taskId === selectedTask.id &&
          draftSourceRef.current.fingerprint !== null &&
          fingerprintDraft(current) !== draftSourceRef.current.fingerprint;

        if (hasLocalEdits) {
          return current;
        }

        draftSourceRef.current = { taskId: selectedTask.id, fingerprint: nextFingerprint };
        return nextDraft;
      });
      return;
    }

    if (selectedTaskId === "new") {
      draftSourceRef.current = { taskId: null, fingerprint: null };
      setDraft(createEmptyDraft(homeDir));
    }
  }, [homeDir, selectedTask, selectedTaskId]);

  async function bootstrap() {
    setIsLoading(true);
    setError(null);

    try {
      const health = await api<{ ok: boolean; homeDir: string }>("/api/health");
      setHomeDir(health.homeDir);
      setDraft(createEmptyDraft(health.homeDir));
      const tasksResponse = await api<{ tasks: Task[] }>("/api/tasks");
      const initialTaskId = tasksResponse.tasks[0]?.id ?? "new";
      const executionsResponse =
        initialTaskId !== "new"
          ? await api<{ executions: Execution[] }>(`/api/executions?taskId=${encodeURIComponent(initialTaskId)}`)
          : { executions: [] };

      setSelectedTaskId(initialTaskId);
      setState({ tasks: tasksResponse.tasks, executions: executionsResponse.executions });
    } catch (requestError) {
      setError(toMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }

  async function refresh(showSpinner = true, taskId = selectedTaskId): Promise<ApiState | null> {
    if (showSpinner) setIsLoading(true);
    setError(null);

    try {
      const tasksResponse = await api<{ tasks: Task[] }>("/api/tasks");
      const executionsResponse =
        taskId && taskId !== "new"
          ? await api<{ executions: Execution[] }>(`/api/executions?taskId=${encodeURIComponent(taskId)}`)
          : { executions: [] };

      const nextState = { tasks: tasksResponse.tasks, executions: executionsResponse.executions };
      setState(nextState);
      return nextState;
    } catch (requestError) {
      setError(toMessage(requestError));
      return null;
    } finally {
      if (showSpinner) setIsLoading(false);
    }
  }

  async function refreshExecution(executionId: string): Promise<void> {
    try {
      const response = await api<{ execution: Execution }>(`/api/executions/${executionId}`);
      setState((current) => ({
        ...current,
        executions: mergeExecutionIntoList(current.executions, response.execution)
      }));

      if (response.execution.status !== "running" && selectedTaskId !== "new") {
        void refresh(false, selectedTaskId);
      }
    } catch (requestError) {
      setError(toMessage(requestError));
    }
  }

  async function saveDraft() {
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
      draftSourceRef.current = { taskId: response.task.id, fingerprint: fingerprintDraft(savedDraft) };
      setDraft(savedDraft);
      setSelectedTaskId(response.task.id);
      await refresh(false, response.task.id);
    } catch (requestError) {
      setError(toMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  }

  async function runSelectedTask() {
    if (!draft.id) return;
    if (selectedTaskRunningExecution) {
      await openSelectedTaskLogs();
      return;
    }

    setIsRunning(true);
    setError(null);

    try {
      const response = await api<{ execution: Execution }>(`/api/tasks/${draft.id}/run`, {
        method: "POST"
      });
      shouldStickToLogEndRef.current = true;
      setState((current) => ({
        ...current,
        executions: mergeExecutionIntoList(current.executions, response.execution)
      }));
      setSelectedExecutionId(response.execution.id);
      setIsLogsOpen(true);
      await refresh(false, draft.id);
    } catch (requestError) {
      setError(toMessage(requestError));
    } finally {
      setIsRunning(false);
    }
  }

  async function continueSelectedExecution() {
    if (!selectedExecution || !canContinueSelectedExecution) return;

    setIsResuming(true);
    setError(null);

    try {
      const response = await api<{ execution: Execution }>(`/api/executions/${selectedExecution.id}/resume`, {
        method: "POST"
      });
      shouldStickToLogEndRef.current = true;
      setState((current) => ({
        ...current,
        executions: mergeExecutionIntoList(current.executions, response.execution)
      }));
      setSelectedExecutionId(response.execution.id);
      setIsLogsOpen(true);
      await refresh(false, response.execution.taskId);
    } catch (requestError) {
      setError(toMessage(requestError));
    } finally {
      setIsResuming(false);
    }
  }

  async function deleteSelectedTask() {
    if (!draft.id) return;
    setPendingDelete({ taskId: draft.id, source: "editor" });
  }

  async function deleteTask(task: Pick<Task, "id" | "title">) {
    setError(null);

    try {
      await api(`/api/tasks/${task.id}`, { method: "DELETE" });

      if (selectedTaskId === task.id) {
        setSelectedTaskId("new");
        setSelectedExecutionId(null);
        setIsLogsOpen(false);
        setPendingDelete(null);
        await refresh(false, "new");
        return;
      }

      setPendingDelete(null);
      await refresh(false, selectedTaskId);
    } catch (requestError) {
      setError(toMessage(requestError));
    }
  }

  function selectScheduleType(type: TaskSchedule["type"]) {
    setDraft((current) => ({ ...current, schedule: defaultSchedule(type) }));
  }

  function updateSchedule(nextSchedule: TaskSchedule) {
    setDraft((current) => ({ ...current, schedule: nextSchedule }));
  }

  function selectTask(task: Task) {
    setSelectedTaskId(task.id);
    setSelectedExecutionId(null);
    void refresh(false, task.id);
  }

  async function openSelectedTaskLogs(): Promise<void> {
    if (!draft.id) return;

    shouldStickToLogEndRef.current = true;
    setIsLogsOpen(true);
    const nextState = await refresh(false, draft.id);
    const executions = nextState?.executions ?? state.executions;
    setSelectedExecutionId((current) =>
      resolveExecutionSelection({
        currentId: current,
        executions,
        taskId: draft.id as string,
        preferRunning: true
      })
    );
  }

  function handleLogScroll(event: UIEvent<HTMLPreElement>) {
    const target = event.currentTarget;
    shouldStickToLogEndRef.current = target.scrollHeight - target.scrollTop - target.clientHeight < 48;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">local automation</p>
          <h1>Codex Routines</h1>
        </div>
        <div className="topbar-actions">
          {error ? (
            <span className="error-pill">{error}</span>
          ) : (
            <>
              <span className="system-pill">
                <Database size={14} />
                {state.tasks.length} tasks
              </span>
              <span className="system-pill">
                <Clock3 size={14} />
                refresh 4s
              </span>
            </>
          )}
        </div>
      </header>

      <main className={`workspace ${isLogsOpen ? "logs-open" : ""}`}>
        <aside className="task-pane" aria-label="Tasks">
          <div className="pane-heading">
            <div>
              <h2>Tasks</h2>
              <span>{state.tasks.length} registered</span>
            </div>
            <button
              className="icon-button primary"
              type="button"
              title="New task"
              onClick={() => {
                setSelectedTaskId("new");
                setSelectedExecutionId(null);
                setIsLogsOpen(false);
                draftSourceRef.current = { taskId: null, fingerprint: null };
                setState((current) => ({ ...current, executions: [] }));
              }}
            >
              <Plus size={18} />
            </button>
          </div>

          <div className="task-list">
            {isLoading && state.tasks.length === 0 ? (
              <div className="muted-line">Loading...</div>
            ) : state.tasks.length === 0 ? (
              <div className="empty-block">No tasks yet.</div>
            ) : (
              state.tasks.map((task) => {
                const isTaskRunning =
                  state.executions.some((execution) => execution.taskId === task.id && execution.status === "running") ||
                  (isRunning && task.id === selectedTaskId);
                const nextRunLabel = task.nextRunAt ? formatDate(task.nextRunAt) : "no upcoming time";
                const sidebarState = isTaskRunning ? "running" : task.enabled ? "enabled" : "paused";

                return (
                  <div key={task.id} className={`task-row task-row-presence ${task.id === selectedTaskId ? "selected" : ""} ${sidebarState}`}>
                    <button className="task-select task-select-presence" type="button" onClick={() => selectTask(task)}>
                      <span className="task-row-top">
                        <span className="task-row-title">{task.title}</span>
                        <span className={`run-presence ${isTaskRunning ? "running" : "idle"}`}>
                          {isTaskRunning ? <Loader2 className="spin" size={13} /> : <Clock3 size={13} />}
                          {isTaskRunning ? "Running" : "Waiting"}
                        </span>
                      </span>
                      <span className="task-row-meta">
                        {task.enabled ? <Power size={14} /> : <PowerOff size={14} />}
                        <span className={`task-state ${task.enabled ? "enabled" : "paused"}`}>
                          {task.enabled ? "Active" : "Paused"}
                        </span>
                        <span>{isTaskRunning ? "Execution in progress" : nextRunLabel}</span>
                      </span>
                    </button>
                    <button
                      className="task-delete"
                      type="button"
                      title={`Delete ${task.title}`}
                      onClick={() => setPendingDelete({ taskId: task.id, source: "sidebar" })}
                    >
                      <Trash2 size={15} />
                    </button>
                    {pendingDelete?.taskId === task.id && pendingDelete.source === "sidebar" && (
                      <div className="task-confirm">
                        <span>Delete task?</span>
                        <button type="button" onClick={() => setPendingDelete(null)}>
                          Cancel
                        </button>
                        <button type="button" onClick={() => void deleteTask(task)}>
                          Delete now
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </aside>

        <section className="editor-pane" aria-label="Editor">
          <div className="pane-heading editor-heading">
            <div>
              <h2>{draft.id ? "Edit routine" : "New routine"}</h2>
              <span>{draft.id ? (hasUnsavedChanges ? "Unsaved changes" : "Saved configuration") : "Local draft"}</span>
            </div>
            <div className="button-row">
              <button className="button ghost" type="button" disabled={!draft.id || isRunning || isSelectedTaskRunning} onClick={runSelectedTask}>
                {isRunning || isSelectedTaskRunning ? <Loader2 className="spin" size={17} /> : <Play size={17} />}
                {isSelectedTaskRunning ? "Running" : "Run"}
              </button>
              <button className="button" type="button" disabled={isSaving} onClick={saveDraft}>
                {isSaving ? <Loader2 className="spin" size={17} /> : <Save size={17} />}
                Save
              </button>
            </div>
          </div>

          <section className="run-summary" aria-label="Routine summary">
            <div className="summary-grid">
              <SummaryItem label="Status" value={draft.enabled ? "Active" : "Paused"} tone={draft.enabled ? "success" : "muted"} />
              <SummaryItem label="Next run" value={selectedTask?.nextRunAt ? formatDate(selectedTask.nextRunAt) : "No schedule"} />
              <SummaryItem label="Last run" value={selectedTask?.lastRunAt ? formatDate(selectedTask.lastRunAt) : "Has not run yet"} />
              <SummaryItem label="Path" value={draft.cwd} mono />
            </div>
            <div className="summary-actions">
              <button
                className="button ghost"
                type="button"
                disabled={!draft.id}
                onClick={() => void openSelectedTaskLogs()}
              >
                {selectedTaskRunningExecution ? <Loader2 className="spin" size={17} /> : <Clock3 size={17} />}
                {selectedTaskRunningExecution ? "Follow" : "Task logs"}
              </button>
              {draft.id && pendingDelete?.taskId === draft.id && pendingDelete.source === "editor" ? (
                <div className="inline-confirm">
                  <span>Confirm deletion?</span>
                  <button className="button ghost" type="button" onClick={() => setPendingDelete(null)}>
                    Cancel
                  </button>
                  <button className="button danger solid" type="button" onClick={() => void deleteTask({ id: draft.id, title: draft.title })}>
                    Delete now
                  </button>
                </div>
              ) : (
                <button className="button danger" type="button" disabled={!draft.id} onClick={deleteSelectedTask}>
                  <Trash2 size={17} />
                  Delete routine
                </button>
              )}
            </div>
          </section>

          <div className="form-grid">
            <label className="field title-field">
              <span>Name</span>
              <input
                value={draft.title}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              />
            </label>

            <label className="toggle-field">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))}
              />
              <span>{draft.enabled ? "Active" : "Paused"}</span>
            </label>

            <label className="field path-field">
              <span>Execution path</span>
              <input
                value={draft.cwd}
                onChange={(event) => setDraft((current) => ({ ...current, cwd: event.target.value }))}
              />
            </label>
          </div>

          <div className="schedule-panel">
            <div className="segmented" role="tablist" aria-label="Schedule type">
              {scheduleOptions.map((option) => (
                <button
                  key={option.type}
                  className={draft.schedule.type === option.type ? "active" : ""}
                  type="button"
                  onClick={() => selectScheduleType(option.type)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <ScheduleFields schedule={draft.schedule} onChange={updateSchedule} />
          </div>

          <div className="markdown-shell">
            <div className="markdown-toolbar">
              <div className="markdown-label">
                <FileText size={16} />
                Prompt markdown
              </div>
              <div className="mini-tabs">
                <button
                  className={editorMode === "edit" ? "active" : ""}
                  type="button"
                  onClick={() => setEditorMode("edit")}
                >
                  Edit
                </button>
                <button
                  className={editorMode === "preview" ? "active" : ""}
                  type="button"
                  onClick={() => setEditorMode("preview")}
                >
                  Preview
                </button>
              </div>
            </div>

            {editorMode === "edit" ? (
              <textarea
                value={draft.prompt}
                spellCheck={false}
                onChange={(event) => setDraft((current) => ({ ...current, prompt: event.target.value }))}
              />
            ) : (
              <div className="markdown-preview">
                {draft.prompt.trim() ? <ReactMarkdown>{draft.prompt}</ReactMarkdown> : <span>No content.</span>}
              </div>
            )}
          </div>

          <div className="danger-row">
            <span>
              <Terminal size={16} />
              codex exec --dangerously-bypass-approvals-and-sandbox
            </span>
          </div>
        </section>

        {isLogsOpen && (
          <aside className="log-pane" aria-label="Logs">
            <div className="pane-heading">
              <div>
                <h2>{selectedTask ? "Task logs" : "Logs"}</h2>
                <span>
                  {selectedTask ? `${selectedTask.title} · ${state.executions.length} executions` : "Select a task"}
                </span>
              </div>
              <button className="icon-button" type="button" title="Close logs" onClick={() => setIsLogsOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="execution-list" aria-hidden="true">
              {!selectedTask ? (
                <div className="empty-block">Select a task to view its logs.</div>
              ) : state.executions.length === 0 ? (
                <div className="empty-block">No executions for this task.</div>
              ) : (
                state.executions.map((execution) => (
                  <button
                    className={`execution-row ${execution.id === selectedExecution?.id ? "selected" : ""}`}
                    type="button"
                    key={execution.id}
                    onClick={() => setSelectedExecutionId(execution.id)}
                  >
                    <span className={`status-dot ${execution.status}`} />
                    <span>
                      <strong>{execution.taskTitle}</strong>
                      <small>{formatDate(execution.startedAt)}</small>
                    </span>
                  </button>
                ))
              )}
            </div>

            <div className="log-detail log-detail-reader">
              {selectedExecution ? (
                <>
                  <div className="log-reader-rail">
                    <div className="log-reader-head">
                      <div>
                        <strong>Logs</strong>
                        <span>{state.executions.length} executions</span>
                      </div>
                      <button className="log-close-button" type="button" title="Close logs" onClick={() => setIsLogsOpen(false)}>
                        <X size={16} />
                      </button>
                    </div>
                    <div className="log-run-list" aria-label="Task executions">
                      {state.executions.map((execution) => (
                        <button
                          className={`log-run-item ${execution.id === selectedExecution.id ? "selected" : ""}`}
                          type="button"
                          key={execution.id}
                          onClick={() => {
                            shouldStickToLogEndRef.current = true;
                            setSelectedExecutionId(execution.id);
                          }}
                        >
                          <span className={`status-dot ${execution.status}`} />
                          <span>
                            <strong>{execution.status === "running" ? "Running now" : formatDate(execution.startedAt)}</strong>
                            <small>
                              {execution.status === "running"
                                ? "Watching"
                                : execution.exitCode === null
                                  ? "no exit code"
                                  : `exit ${execution.exitCode}`}
                            </small>
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="log-reader-current">
                      <span className={`badge ${selectedExecution.status}`}>
                        {selectedExecution.status === "running" && <Loader2 className="spin" size={13} />}
                        {selectedExecution.status === "success" && <Check size={13} />}
                        {selectedExecution.status === "stale" && <AlertTriangle size={13} />}
                        {selectedExecution.status}
                      </span>
                      <span>{selectedExecution.exitCode === null ? "no exit code" : `exit ${selectedExecution.exitCode}`}</span>
                    </div>
                  </div>
                  <div className="log-reader-main">
                    <div className="log-reader-toolbar">
                      <div className="log-reader-title">
                        <strong>{selectedExecution.taskTitle}</strong>
                        <span>
                          {selectedExecution.status === "running"
                            ? "Watching live"
                            : selectedExecution.status === "stale"
                              ? "Execution has no active platform process"
                            : selectedExecution.finishedAt
                              ? `Finished ${formatDate(selectedExecution.finishedAt)}`
                              : "Open execution"}
                        </span>
                      </div>
                      {canContinueSelectedExecution && (
                        <button className="button resume-button" type="button" disabled={isResuming} onClick={() => void continueSelectedExecution()}>
                          {isResuming ? <Loader2 className="spin" size={16} /> : <RotateCcw size={16} />}
                          Continue
                        </button>
                      )}
                    </div>
                    {selectedExecutionNeedsRecovery && (
                      <div className="recovery-banner">
                        <AlertTriangle size={17} />
                        <div>
                          <strong>Execution may be stuck</strong>
                          {canContinueSelectedExecution ? (
                            <span>
                              The platform is no longer tracking this process. Continue resumes Codex session{" "}
                              <code>{selectedExecution.resumeSessionId}</code> in a new tracked execution.
                            </span>
                          ) : (
                            <span>
                              The platform is no longer tracking this process and did not find a Codex session id in the logs. Run the task
                              again if you need to restart.
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                    <pre ref={logPreRef} aria-live={selectedExecution.status === "running" ? "polite" : undefined} onScroll={handleLogScroll}>
                      {buildLogText(selectedExecution)}
                    </pre>
                  </div>
                </>
              ) : (
                <>
                  <div className="log-reader-rail">
                    <div className="log-reader-head">
                      <div>
                        <strong>Logs</strong>
                        <span>{state.executions.length} executions</span>
                      </div>
                      <button className="log-close-button" type="button" title="Close logs" onClick={() => setIsLogsOpen(false)}>
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="empty-block">Select an execution.</div>
                </>
              )}
            </div>
          </aside>
        )}
      </main>
    </div>
  );
}

function SummaryItem(props: { label: string; value: string; tone?: "success" | "muted"; mono?: boolean }) {
  return (
    <div className={`summary-item ${props.tone ?? ""} ${props.mono ? "mono" : ""}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function ScheduleFields(props: { schedule: TaskSchedule; onChange: (schedule: TaskSchedule) => void }) {
  const { schedule, onChange } = props;

  if (schedule.type === "manual") {
    return (
      <div className="schedule-fields">
        <span className="schedule-note">
          <CalendarClock size={16} />
          No automatic trigger
        </span>
      </div>
    );
  }

  if (schedule.type === "once") {
    return (
      <div className="schedule-fields">
        <label className="field">
          <span>Date and time</span>
          <input type="datetime-local" value={schedule.runAt} onChange={(event) => onChange({ ...schedule, runAt: event.target.value })} />
        </label>
      </div>
    );
  }

  if (schedule.type === "interval") {
    return (
      <div className="schedule-fields">
        <label className="field short-field">
          <span>Minutes</span>
          <input
            type="number"
            min={1}
            value={schedule.everyMinutes}
            onChange={(event) => onChange({ ...schedule, everyMinutes: Number(event.target.value) })}
          />
        </label>
      </div>
    );
  }

  if (schedule.type === "daily") {
    return (
      <div className="schedule-fields">
        <label className="field short-field">
          <span>Time</span>
          <input type="time" value={schedule.time} onChange={(event) => onChange({ ...schedule, time: event.target.value })} />
        </label>
      </div>
    );
  }

  if (schedule.type === "weekly") {
    return (
      <div className="schedule-fields two-cols">
        <label className="field">
          <span>Day</span>
          <select value={String(schedule.dayOfWeek)} onChange={(event) => onChange({ ...schedule, dayOfWeek: Number(event.target.value) })}>
            {weekdays.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field short-field">
          <span>Time</span>
          <input type="time" value={schedule.time} onChange={(event) => onChange({ ...schedule, time: event.target.value })} />
        </label>
      </div>
    );
  }

  return (
    <div className="schedule-fields">
      <label className="field">
        <span>Expression</span>
        <input value={schedule.expression} onChange={(event) => onChange({ ...schedule, expression: event.target.value })} />
      </label>
    </div>
  );
}

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
  if (type === "once") return { type, runAt: toDatetimeLocal(new Date(Date.now() + 60 * 60_000)) };
  if (type === "interval") return { type, everyMinutes: 60 };
  if (type === "daily") return { type, time: "09:00" };
  if (type === "weekly") return { type, dayOfWeek: 1, time: "09:00" };
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

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function toDatetimeLocal(date: Date): string {
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function buildLogText(execution: Execution): string {
  const command = `$ ${execution.command.join(" ")}`;
  const error = execution.error ? `\n\n[error]\n${execution.error}` : "";
  const stderr = execution.stderr ? `\n\n[stderr]\n${execution.stderr}` : "";
  const emptyStdout = execution.status === "running" ? "waiting for codex output..." : "";
  const stdout = `\n\n[stdout]\n${execution.stdout || emptyStdout}`;
  return `${command}\n\ncwd: ${execution.cwd}${stdout}${stderr}${error}`;
}
