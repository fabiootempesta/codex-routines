# Codex Routines

Codex Routines turns Codex CLI into a local scheduled worker.

Create repeatable routines, choose the repository they should run in, write the prompt in Markdown, pick a schedule, and let the app launch `codex exec` for you. It is built for developers who already trust Codex in the terminal and want recurring maintenance, cleanup, review, reporting, or repository automation without babysitting a shell.

## What It Does

- Schedule Codex tasks manually, once, by interval, daily, weekly, or with cron syntax.
- Run every task from an explicit working directory.
- Store task configuration and execution history locally.
- Stream stdout, stderr, exit codes, failures, and stuck execution state in the UI.
- Resume orphaned Codex executions when a session id is available in the logs.
- Run as a small local daemon and expose a browser UI on your machine or LAN.

## Requirements

You need:

- Node.js 20 or newer.
- npm.
- Codex CLI installed and available as `codex` in the same environment that starts the daemon.
- Codex CLI authenticated and able to run `codex exec`.
- A modern browser.
- Absolute filesystem paths for task working directories.

The app is designed for macOS, Linux, and WSL. Native Windows may work if Node and Codex CLI are configured correctly, but it is not the primary target.

## Security Model

Codex Routines is local-first, but it can run powerful commands.

Each routine executes:

```bash
codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --color never --cd <path> -
```

The task prompt is sent through stdin.

That means a routine can modify files, run commands, and act inside the selected working directory without interactive approval. Use it only on machines and repositories where that is acceptable. Do not expose the app to an untrusted network.

## Quick Start

```bash
npm install
npm run build
npm run daemon:start
```

Open:

```text
http://localhost:4173
```

The daemon also prints LAN URLs when it starts, for example `http://192.168.1.20:4173`.

## Daily Use

Check whether the daemon is running:

```bash
npm run daemon:status
```

Stop it:

```bash
npm run daemon:stop
```

Start it on a different port:

```bash
PORT=4180 npm run daemon:start
```

Bind only to localhost:

```bash
HOST=127.0.0.1 npm run daemon:start
```

## Local Data

By default, Codex Routines writes:

- Tasks and executions: `data/db.json`
- Server PID: `runtime/server.pid`
- Server log: `runtime/server.log`

Use a custom database path:

```bash
CODEX_ROUTINES_DB=/absolute/path/codex-routines-db.json npm run daemon:start
```

The database is a JSON file. Back it up if your routine history matters.

## Creating A Routine

1. Click the plus button.
2. Name the routine.
3. Set the execution path to an absolute directory, usually a repository.
4. Choose whether the routine is active or paused.
5. Pick a schedule.
6. Write the Codex prompt in Markdown.
7. Save.
8. Use `Run` for a manual execution or wait for the schedule.

Good routines are explicit. Include the goal, constraints, verification command, and what Codex should report when it finishes.

## Development

For production-style local testing:

```bash
npm run build
npm start
```

For development with hot reload, run two terminals:

```bash
npm run dev
```

```bash
npx vite --host 0.0.0.0
```

Then open:

```text
http://localhost:5173
```

The Vite dev server proxies `/api` to the backend on port `4173`.

Run tests:

```bash
npm test
```

## Troubleshooting

`Build not found`

Run `npm run build` before `npm run daemon:start`.

`codex: command not found`

Install Codex CLI and confirm `codex --version` works from the same shell that starts Codex Routines.

`Path must be absolute`

Use a full path such as `/Users/you/project` or `/home/you/project`.

`Path must point to a directory`

Create the directory first, or choose an existing repository folder.

`Port already in use`

Start with another port:

```bash
PORT=4180 npm run daemon:start
```

The UI says the client has not been built

Run:

```bash
npm run build
```

## What This Is Not

Codex Routines is not a hosted workflow platform, a multi-user dashboard, or a permission system. It is a focused local command center for scheduled Codex CLI work.
