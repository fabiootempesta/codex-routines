import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";
import { getNetworkUrls } from "./network.js";
import { createApiRouter } from "./routes.js";
import { Scheduler } from "./scheduler.js";
import { createStorePath, JsonStore } from "./store.js";

const projectRoot = process.cwd();
const store = new JsonStore(createStorePath(projectRoot));
await store.init();

const scheduler = new Scheduler(store);
const app = express();
const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? "0.0.0.0";

app.use(express.json({ limit: "2mb" }));
app.use("/api", createApiRouter(store, scheduler));

await serveClient(app);

const server = app.listen(port, host, () => {
  scheduler.start();
  console.log("Codex Rotinas ouvindo em:");
  for (const url of getNetworkUrls(port)) {
    console.log(`- ${url}`);
  }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    scheduler.stop();
    server.close(() => {
      process.exit(0);
    });
  });
}

async function serveClient(application: express.Express): Promise<void> {
  const clientDir = path.resolve(projectRoot, "dist", "client");

  try {
    await access(clientDir);
  } catch {
    application.get("/", (_request, response) => {
      response
        .status(503)
        .type("text/plain")
        .send("Client ainda nao foi buildado. Rode npm run build antes de npm start.");
    });
    return;
  }

  application.use(express.static(clientDir));
  application.get("*", (_request, response) => {
    response.sendFile(path.join(clientDir, "index.html"));
  });
}

export const __filename = fileURLToPath(import.meta.url);
