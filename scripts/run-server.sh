#!/usr/bin/env bash
# Run the JDDC dev webserver (Vite).
#
# Performs preflight checks before starting:
#   1. Locates a Node >= 22 (required by Vite 8 / rolldown native bindings);
#      offers to install one via nvm if none is found.
#   2. Verifies npm dependencies are installed and consistent with
#      package.json; offers to (re)install if not.
#   3. Checks whether something is already listening on the target port;
#      offers to kill it.
#
# Usage: scripts/run-server.sh [-y] [-p PORT]
#   -y       answer yes to all prompts (non-interactive)
#   -p PORT  port to check/serve on (default 5173, Vite's default)

set -euo pipefail

PORT=5173
ASSUME_YES=0
MIN_NODE_MAJOR=22

while getopts ':yp:' opt; do
  case "$opt" in
    y) ASSUME_YES=1 ;;
    p) PORT="$OPTARG" ;;
    *) echo "Usage: $0 [-y] [-p PORT]" >&2; exit 2 ;;
  esac
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

info()  { printf '\033[1;34m[run-server]\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m[run-server]\033[0m %s\n' "$*"; }
fail()  { printf '\033[1;31m[run-server]\033[0m %s\n' "$*" >&2; exit 1; }

confirm() {
  # confirm "question" — returns 0 on yes
  if [ "$ASSUME_YES" -eq 1 ]; then
    info "$1 [auto-yes]"
    return 0
  fi
  local reply
  read -r -p "$(printf '\033[1;34m[run-server]\033[0m %s [y/N] ' "$1")" reply
  [[ "$reply" =~ ^[Yy] ]]
}

node_major() { "$1" -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/'; }

# --- 1. Node version ---------------------------------------------------------
find_node() {
  # Prefer node already on PATH if new enough.
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node_major node)"
    if [ -n "$major" ] && [ "$major" -ge "$MIN_NODE_MAJOR" ]; then
      return 0
    fi
    warn "node on PATH is $(node -v) — need v${MIN_NODE_MAJOR}+."
  else
    warn "node not found on PATH."
  fi

  # Look for an installed nvm version that satisfies the requirement.
  local dir best=''
  for dir in "$HOME"/nvm/versions/node/v*/bin "$HOME"/.nvm/versions/node/v*/bin; do
    [ -x "$dir/node" ] || continue
    local major
    major="$(node_major "$dir/node")"
    if [ -n "$major" ] && [ "$major" -ge "$MIN_NODE_MAJOR" ]; then
      best="$dir"
    fi
  done
  if [ -n "$best" ]; then
    info "Using node $("$best/node" -v) from $best"
    export PATH="$best:$PATH"
    return 0
  fi

  # Offer to install via nvm.
  local nvm_sh=''
  for nvm_sh in "$HOME/nvm/nvm.sh" "$HOME/.nvm/nvm.sh"; do
    [ -s "$nvm_sh" ] && break
    nvm_sh=''
  done
  if [ -n "$nvm_sh" ]; then
    if confirm "Node v${MIN_NODE_MAJOR}+ is required but not installed. Install with nvm?"; then
      # shellcheck disable=SC1090
      . "$nvm_sh"
      nvm install "$MIN_NODE_MAJOR"
      nvm use "$MIN_NODE_MAJOR"
      return 0
    fi
    fail "Node v${MIN_NODE_MAJOR}+ is required. Aborting."
  fi
  fail "Node v${MIN_NODE_MAJOR}+ is required and nvm was not found. Install Node ${MIN_NODE_MAJOR} and re-run."
}

find_node
info "node $(node -v) / npm $(npm -v)"

# --- 2. npm dependencies -----------------------------------------------------
deps_ok() {
  [ -d node_modules ] || return 1
  # npm ls exits non-zero on missing/invalid deps (covers a node_modules
  # installed under an older Node, where native bindings won't match).
  npm ls --depth=0 >/dev/null 2>&1
}

if ! deps_ok; then
  if [ -d node_modules ]; then
    warn "node_modules is present but inconsistent with package.json."
    if confirm "Clean-reinstall dependencies (rm -rf node_modules + npm install)?"; then
      rm -rf node_modules
      npm install
    else
      fail "Dependencies are not satisfied. Aborting."
    fi
  else
    warn "Dependencies are not installed."
    if confirm "Run npm install?"; then
      npm install
    else
      fail "Dependencies are not installed. Aborting."
    fi
  fi
  deps_ok || fail "Dependency check still failing after install — see npm output above."
fi
info "Dependencies OK."

# --- 3. Port availability ----------------------------------------------------
port_pids() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true
  elif command -v fuser >/dev/null 2>&1; then
    fuser "$PORT"/tcp 2>/dev/null | tr -s ' ' '\n' || true
  else
    # ss fallback: extract pid=N from the listener line.
    ss -ltnp 2>/dev/null | awk -v p=":$PORT" '$4 ~ p"$"' \
      | grep -oP 'pid=\K[0-9]+' | sort -u || true
  fi
}

PIDS="$(port_pids)"
if [ -n "$PIDS" ]; then
  warn "Port $PORT is already in use:"
  for pid in $PIDS; do
    warn "  pid $pid — $(ps -p "$pid" -o args= 2>/dev/null || echo '<unknown>')"
  done
  if confirm "Kill the process(es) on port $PORT?"; then
    for pid in $PIDS; do kill "$pid" 2>/dev/null || true; done
    sleep 1
    # Escalate if anything survived.
    LEFT="$(port_pids)"
    if [ -n "$LEFT" ]; then
      warn "Process(es) still alive, sending SIGKILL."
      for pid in $LEFT; do kill -9 "$pid" 2>/dev/null || true; done
      sleep 1
    fi
    [ -z "$(port_pids)" ] || fail "Could not free port $PORT."
    info "Port $PORT freed."
  else
    warn "Continuing anyway — Vite will pick the next free port (note: 'npm run electron' expects $PORT)."
  fi
fi

# --- start --------------------------------------------------------------------
info "Starting dev server on port $PORT…"
exec npm run dev -- --port "$PORT"
