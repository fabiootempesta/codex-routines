# Codex Routines

Local platform for scheduling Codex CLI executions with markdown prompts, execution directories, and logs.

## Run

```bash
npm install
npm run build
npm run daemon:start
```

Open `http://localhost:4173`.

## Stop And Check

```bash
npm run daemon:status
npm run daemon:stop
```

## Local Data

- Tasks and executions are stored in `data/db.json`.
- Set `CODEX_ROUTINES_DB` to use a different database file.
- The server log is stored in `runtime/server.log`.
- Each execution runs with:

```bash
codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --color never --cd <path> -
```

The task prompt is sent to the process through stdin.
