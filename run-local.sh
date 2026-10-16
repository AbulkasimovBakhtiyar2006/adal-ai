#!/usr/bin/env bash
set -euo pipefail
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$PROJECT_DIR/frontend/adal-ai/frontend"
PYTHON_BIN="$PROJECT_DIR/backend/.venv/bin/python"

# Prefer the installed Node. The desktop runtime is a fallback on this machine.
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' 2>/dev/null; then
  BUNDLED_NODE_DIR="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
  if [[ -x "$BUNDLED_NODE_DIR/node" ]]; then
    export PATH="$BUNDLED_NODE_DIR:$PATH"
  else
    echo 'Установите Node.js 22.12+ и npm перед запуском.' >&2
    exit 1
  fi
fi
if [[ ! -x "$PYTHON_BIN" ]]; then
  echo 'Создайте Python-окружение backend по инструкции backend/README.md.' >&2
  exit 1
fi
cd "$FRONTEND_DIR"
if [[ ! -d node_modules ]]; then npm ci --no-audit --no-fund; fi
npm run build
cd "$PROJECT_DIR/backend"
echo 'Сайт: http://127.0.0.1:8000   Настройки ИИ: http://127.0.0.1:8000/admin'
exec "$PYTHON_BIN" -m app
