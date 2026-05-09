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
  await page.getByText("Codex Rotinas").first().waitFor();
  await assertNoRefreshButton(page);
  await assertLogsHidden(page);
  await page.getByTitle("Nova tarefa").click();
  await page.getByLabel("Nome").fill(smokeTitle);
  await page.getByLabel("Caminho de execucao").fill(smokeCwd);
  await page.locator("textarea").fill("# Smoke\n\nListe o diretorio atual.");

  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/tasks") && response.request().method() === "POST"),
    page.getByRole("button", { name: /Salvar/ }).click()
  ]);

  await page.getByRole("button", { name: new RegExp(`^${escapeRegExp(smokeTitle)}`) }).waitFor();
  await page.getByText("Resumo da rotina").waitFor({ state: "hidden" }).catch(() => undefined);
  await page.getByLabel("Resumo da rotina").getByText("Ativa").waitFor();
  await page.getByRole("button", { name: /Excluir rotina/ }).click();
  await page.getByText("Confirmar exclusao?").waitFor();
  await page.getByRole("button", { name: "Cancelar" }).click();
  await page.getByRole("button", { name: /Logs da tarefa/ }).click();
  await page.getByLabel("Logs").waitFor();
  await page.getByRole("button", { name: /Fechar logs/ }).first().click();
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
  await page.getByText("Codex Rotinas").first().waitFor();
  await assertNoRefreshButton(page);
  await assertLogsHidden(page);
  await page.getByText("Tarefas").first().waitFor();
  await page.screenshot({ path: path.join(runtimeDir, "smoke-mobile.png"), fullPage: true });
  await page.close();
}

async function assertNoRefreshButton(page) {
  const refreshButtonCount = await page.getByTitle("Atualizar").count();
  if (refreshButtonCount !== 0) {
    throw new Error("Botao de refresh deve ficar escondido da interface.");
  }
}

async function assertLogsHidden(page) {
  const logsPane = page.getByLabel("Logs");
  if ((await logsPane.count()) > 0 && (await logsPane.first().isVisible())) {
    throw new Error("Tela de logs deve iniciar escondida.");
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
