# Codex Rotinas

Plataforma local para agendar execucoes do Codex CLI com prompt markdown, diretorio de execucao e logs.

## Rodar

```bash
npm install
npm run build
npm run daemon:start
```

Abra `http://localhost:4173`.

## Parar e verificar

```bash
npm run daemon:status
npm run daemon:stop
```

## Dados locais

- Tarefas e execucoes ficam em `data/db.json`.
- Log do servidor fica em `runtime/server.log`.
- Cada execucao roda com:

```bash
codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --color never --cd <caminho> -
```

O prompt da tarefa e enviado ao stdin do processo.
