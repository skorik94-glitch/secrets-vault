#!/usr/bin/env bash
# One-command install of the Hush plugin for Claude Code.
# Requires the `claude` CLI on PATH. For a private repo, your git credentials
# (gh auth / SSH) must allow cloning skorik94-glitch/hush.

REPO="skorik94-glitch/hush"
PLUGIN="hush@hush"

if ! command -v claude >/dev/null 2>&1; then
  echo "error: the 'claude' CLI is not on your PATH. Open Claude Code and use /plugin instead." >&2
  exit 1
fi

echo "1/3 Adding marketplace ($REPO)…"
claude plugin marketplace add "$REPO" 2>/dev/null || echo "    (already added — continuing)"

echo "2/3 Installing plugin ($PLUGIN)…"
claude plugin install "$PLUGIN"

echo "3/3 Done."
echo
echo "Restart Claude Code (or run /reload-plugins), then try:"
echo "  /hush:doctor"
echo "  /hush:services"
