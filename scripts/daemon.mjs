import { constants } from "node:fs";
import { access, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDir = path.join(root, "runtime");
const pidPath = path.join(runtimeDir, "server.pid");
const logPath = path.join(runtimeDir, "server.log");
const serverEntry = path.join(root, "dist", "server", "index.js");
const port = process.env.PORT ?? "4173";
const host = process.env.HOST ?? "0.0.0.0";

const command = process.argv[2];

if (!["start", "stop", "status"].includes(command)) {
  console.error("Usage: node scripts/daemon.mjs <start|stop|status>");
  process.exit(1);
}

if (command === "start") {
  await start();
} else if (command === "stop") {
  await stop();
} else {
  await status();
}

async function start() {
  await mkdir(runtimeDir, { recursive: true });

  const existingPid = await readPid();
  if (existingPid && isRunning(existingPid)) {
    console.log(`Codex Routines is already running on PID ${existingPid}.`);
    return;
  }

  await access(serverEntry, constants.R_OK).catch(() => {
    throw new Error("Build not found. Run npm run build before npm run daemon:start.");
  });

  const logFile = await open(logPath, "a");
  const child = spawn(process.execPath, [serverEntry], {
    cwd: root,
    detached: true,
    stdio: ["ignore", logFile.fd, logFile.fd],
    env: {
      ...process.env,
      HOST: host,
      PORT: port
    }
  });

  child.unref();
  await writeFile(pidPath, `${child.pid}\n`, "utf8");
  console.log(`Codex Routines started on PID ${child.pid}.`);
  printUrls();
  console.log(`Server log: ${logPath}`);
}

async function stop() {
  const pid = await readPid();

  if (!pid) {
    console.log("No PID registered.");
    return;
  }

  if (!isRunning(pid)) {
    await rm(pidPath, { force: true });
    console.log("Removed stale PID.");
    return;
  }

  process.kill(pid, "SIGTERM");
  await rm(pidPath, { force: true });
  console.log(`Codex Routines stopped on PID ${pid}.`);
}

async function status() {
  const pid = await readPid();

  if (pid && isRunning(pid)) {
    console.log(`Codex Routines is running on PID ${pid}.`);
    printUrls();
    return;
  }

  console.log("Codex Routines is not running.");
}

async function readPid() {
  try {
    const raw = await readFile(pidPath, "utf8");
    const pid = Number(raw.trim());
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function printUrls() {
  console.log("URLs:");
  for (const url of getNetworkUrls()) {
    console.log(`- ${url}`);
  }
}

function getNetworkUrls() {
  const urls = new Set([`http://localhost:${port}`]);

  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    if (!entries || /^(br-|docker|veth|virbr|tailscale|zt|tun|tap)/.test(name)) continue;

    for (const entry of entries) {
      if (entry.internal || entry.family !== "IPv4") continue;
      if (!isLikelyLanAddress(entry.address)) continue;
      urls.add(`http://${entry.address}:${port}`);
    }
  }

  return [...urls];
}

function isLikelyLanAddress(address) {
  if (address.startsWith("192.168.")) return true;
  if (address.startsWith("10.")) return true;

  const [first, second] = address.split(".").map(Number);
  return first === 172 && second >= 16 && second <= 31;
}
