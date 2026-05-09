import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:4173";
const runtimeDir = path.resolve("runtime");
const smokeCwd = process.cwd();
const smokeTitle = `Smoke Manual ${Date.now()}`;
await mkdir(runtimeDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: "/usr/bin/google-chrome"
});

try {
  await checkDesktop();
  await checkMobile();
} finally {
  await cleanupSmokeTasks();
  await browser.close();
}

async function checkDesktop() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("dialog", (dialog) => {
    throw new Error(`Browser dialog should not be used: ${dialog.message()}`);
  });

  await page.goto(baseUrl);
  await page.waitForLoadState("networkidle");
  await page.getByText("Codex Routines").first().waitFor();
  await assertNoRefreshButton(page);
  await assertLogsHidden(page);
  await page.getByTitle("New task").click();
  await page.getByLabel("Name").fill(smokeTitle);
  await page.getByLabel("Execution path").fill(smokeCwd);
  await page.locator("textarea").fill("# Smoke\n\nList the current directory.");

  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/tasks") && response.request().method() === "POST"),
    page.getByRole("button", { name: /Save/ }).click()
  ]);

  await page.getByRole("button", { name: new RegExp(`^${escapeRegExp(smokeTitle)}`) }).waitFor();
  await page.getByText("Routine summary").waitFor({ state: "hidden" }).catch(() => undefined);
  await page.getByLabel("Routine summary").getByText("Active").waitFor();
  await page.getByRole("button", { name: /Delete routine/ }).click();
  await page.getByText("Confirm deletion?").waitFor();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: /Task logs/ }).click();
  await page.getByLabel("Logs").waitFor();
  await page.getByRole("button", { name: /Close logs/ }).first().click();
  await assertLogsHidden(page);
  await page.screenshot({ path: path.join(runtimeDir, "smoke-desktop.png"), fullPage: true });

  if (consoleErrors.length > 0) {
    throw new Error(`Console errors: ${consoleErrors.join("\n")}`);
  }

  await page.close();
}

async function checkMobile() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await page.goto(baseUrl);
  await page.waitForLoadState("networkidle");
  await page.getByText("Codex Routines").first().waitFor();
  await assertNoRefreshButton(page);
  await assertLogsHidden(page);
  await page.getByText("Tasks").first().waitFor();
  await page.screenshot({ path: path.join(runtimeDir, "smoke-mobile.png"), fullPage: true });
  await page.close();
}

async function assertNoRefreshButton(page) {
  const refreshButtonCount = await page.getByTitle("Refresh").count();
  if (refreshButtonCount !== 0) {
    throw new Error("Refresh button must stay hidden from the interface.");
  }
}

async function assertLogsHidden(page) {
  const logsPane = page.getByLabel("Logs");
  if ((await logsPane.count()) > 0 && (await logsPane.first().isVisible())) {
    throw new Error("Logs screen must start hidden.");
  }
}

async function cleanupSmokeTasks() {
  const response = await fetch(`${baseUrl}/api/tasks`);
  if (!response.ok) return;

  const payload = await response.json();
  for (const task of payload.tasks.filter((item) => item.title === smokeTitle)) {
    await fetch(`${baseUrl}/api/tasks/${task.id}`, { method: "DELETE" });
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
