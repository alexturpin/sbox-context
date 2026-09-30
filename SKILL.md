---
name: sbox-context
description: Set up s&box references and the editor MCP connection, and consult documentation, API pages, and optional engine source during s&box development.
---

# s&box Context

Use official s&box references to ground engine-specific decisions. This skill provides portable fetchers, editor MCP connection setup, and a lookup workflow; the downloaded snapshots belong to the user's project. Keep other game references, architecture, and simulation/testing rules under that project's control.

## Connect the editor MCP server

Include the editor MCP connection in normal project setup, unless the user requested only reference downloads. For MCP-only setup, skip snapshot downloads. Read [references/mcp-setup.md](references/mcp-setup.md) for the connection configuration, read-only check, and troubleshooting steps.

The server is built into the running s&box editor; it is not a package the skill installs or a separate background service. Configure or reuse the Codex connection, verify the server identity and open project, and report configuration and live availability separately. A closed editor should not prevent completing reference setup.

Before editor operations, use `editor_status` to confirm the intended project is open. Discover tools with `search_tools` and invoke them with `call_tool`; read `read_console` after relevant operations. Use the connected MCP tools when available, keeping editor mutations within the user's task. Automated editor checks supplement the user's final visual/gameplay validation.

## Consult references

- Inspect the project's `AGENTS.md` and run `node "<skill-dir>/scripts/sbox-context.js" status --project-root "<project-root>"` to discover installed snapshots. Respect configured paths in `sbox-context.lock.json`; defaults are `docs/sbox-docs`, `docs/sbox-api`, and `reference/sbox-public`.
- Search documentation for concepts and recommended usage. Search API `types/` pages for exact types, signatures, and members; topic indexes help discovery but are heuristic groupings. Use targeted `rg` searches and file reads rather than loading an entire index or source tree.
- For engine/editor behavior the documentation does not explain, inspect the relevant public source. If source is absent and the investigation needs it, fetch only `source`. Treat implementation details as evidence about that revision, not automatically as supported game APIs.
- Check snapshot provenance before assuming a result applies to the installed engine. The website documentation, published API schema, source revision, and installed editor can differ. Prefer project pins and installed templates for version-sensitive questions. Use official online pages when local material is missing or outdated; do not silently refresh a project's pinned snapshots.
- Record transferable findings near the relevant project code, with evidence and version/issue context. Keep temporary shader workarounds and game-specific findings in the project; do not turn a past bug into an unconditional engine rule.
- Engine-independent checks do not establish rendering, input, networking, or editor behavior. Give the user concrete s&box editor validation steps when those behaviors are affected, and distinguish those steps from checks actually run.

## Set up or refresh snapshots

The helpers need Node.js 22 or newer, network access, and Git only for source. They use Node built-ins; no npm dependency installation or shell wrappers are required. Resolve `<skill-dir>` from this skill's location, never from the target project.

```text
node "<skill-dir>/scripts/sbox-context.js" sync --project-root "<project-root>"
node "<skill-dir>/scripts/sbox-context.js" sync --project-root "<project-root>" --resources source
node "<skill-dir>/scripts/sbox-context.js" sync --project-root "<project-root>" --resources all
node "<skill-dir>/scripts/sbox-context.js" status --project-root "<project-root>"
```

Normal skill setup connects the editor MCP server and fetches docs and API. The `sync` helper itself only downloads references; MCP configuration is handled by the agent following the section above. Include source for a requested full setup or an investigation needing implementation evidence. Reuse suitable existing snapshots. On refresh, select only the resources requested or relevant to the task.

- Paths may be customized with `--docs-dir`, `--api-dir`, and `--source-dir`, relative to the project root. Previously recorded paths are reused when these options are omitted. Keep paths disjoint and inside the project.
- Use `--source-ref <commit-or-tag-or-branch>` to select source and `--api-url <official-schema-json-url>` to select a published API snapshot. Without a new selection, refresh reuses a recorded pin. A default source fetch resolves upstream HEAD once and records its commit; `--source-ref HEAD` explicitly advances it. A default API fetch resolves the published schema once and records its URL; `--api-url latest` explicitly advances it. Website docs have no release pin and are dated and hashed snapshots.
- Existing directories without manifest ownership are refused by default. For an explicitly requested migration, inspect their contents and modifications, preserve any custom work, and use `--adopt` only for the disposable reference directories the user wants replaced. Managed snapshots with local edits are always refused; move/preserve those edits before refreshing.
- Downloads are staged and validated before publication. Each resource commits independently with its manifest entry. If a later resource fails, earlier successful resources remain installed. Report that partial outcome, and do not claim all requested resources refreshed.
- Keep the manifest with the project. During requested setup, merge the small guidance in [assets/agents-snippet.md](assets/agents-snippet.md) into the existing `AGENTS.md`, adjusting paths and including source guidance when available. Preserve unrelated instructions. Add only the generated snapshot directories, `.sbox-context-stage-*/`, and `.sbox-context-update.lock` to `.gitignore` if the project does not intentionally commit its references; leave the manifest tracked.

Run `--help` for pacing and timeout options. If an upstream change breaks discovery or schema validation, retain the previous snapshot and investigate the official endpoint instead of generating an empty replacement. A Windows directory lock may require the user to close the process watching the snapshot before retrying.

After setup or refresh, report installed resources, paths, version identifiers, MCP configuration/reachability and open-project checks, and any failures. Do not initialize a game, download unrelated reference implementations, build the engine source, or publish anything as part of reference setup.
