# sbox-context

A reusable Codex skill for preparing and consulting official s&box documentation, API pages, optional public engine source, and the editor MCP connection. Install this repository's root as a skill folder named `sbox-context` in your Codex user skill location; keep a single checkout to maintain the scripts once. Nothing needs to be copied into each game repository.

The root `SKILL.md` is the entry point. Invoke `$sbox-context` while working in an s&box project, for example: "Use $sbox-context to set up references and the editor MCP connection in this project." Source is optional: ask for full setup or request it during an engine investigation. See `SKILL.md` for the development lookup workflow.

## Run directly

Requires Node.js 22+ and network access; source downloads additionally require Git. No npm packages are needed.

```powershell
node C:\Users\alext\src\sbox-context\scripts\sbox-context.js sync --project-root C:\path\to\game
node C:\Users\alext\src\sbox-context\scripts\sbox-context.js sync --project-root C:\path\to\game --resources all
node C:\Users\alext\src\sbox-context\scripts\sbox-context.js status --project-root C:\path\to\game
```

Default outputs are `docs/sbox-docs`, `docs/sbox-api`, and optional `reference/sbox-public`. `sbox-context.lock.json` records provenance, selection, and content fingerprints. Existing pins and paths are reused on refresh. To advance a source pin, pass `--source-ref HEAD`; to advance an API pin, pass `--api-url latest`. Documentation is a timestamped website snapshot and cannot be pinned to an engine release.

Use `--help` for custom paths, timeouts, and pacing. Legacy snapshots require an explicit `--adopt` after inspecting/preserving custom files. Managed snapshots containing local edits are refused. Snapshot and manifest publication use staged replacement with rollback; if Windows locks a directory, close its watcher and retry. Resources commit individually, so an error fetching API after docs succeeded leaves the new docs and the old API intact. A project update lock prevents overlapping publications. If a process crashes, inspect its lock and retained staging directory before removing a stale lock and retrying.

Keep the lock manifest in version control. Usually ignore generated snapshots; projects needing frozen references can commit them. The optional `assets/agents-snippet.md` is merged by the agent during requested setup, not by the fetcher. No other references or project instructions are modified automatically.

## Editor MCP

Normal skill setup also configures or reuses the Codex connection to the editor's built-in MCP server. Default: `http://127.0.0.1:7269/mcp`. The editor must be running with the intended game project open. Its **Editor → Preferences → MCP Server** page shows the current URL and enablement. No separate server package is installed.

The agent follows `references/mcp-setup.md` to merge project-scoped Codex configuration and verify the open project. Direct `sync` commands only download references; they do not change Codex configuration. You can independently check the running server with:

```powershell
node C:\Users\alext\src\sbox-context\scripts\check-mcp.js
```

The helper initializes MCP, lists tools, and reads editor status. It changes neither configuration nor editor content. A closed editor causes the check to fail with setup guidance; reference downloads still work. Test the connection through Codex after reloading its MCP configuration to confirm that tools are available in the chat.

## Maintain

```powershell
node --test C:\Users\alext\src\sbox-context\scripts\tests\*.test.js
```

Tests exercise fixture-based docs/API acquisition, failed refresh rollback, edit detection, path containment, pin reuse, and source snapshots from a local Git repository, and read-only MCP handshake/discovery behavior with fixtures. Live upstream downloads are separate smoke checks because endpoints and engine releases change. These scripts began with the reference fetchers in Border Royale; game-specific mechanics and reference implementations are excluded.
