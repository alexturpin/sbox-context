---
name: sbox-context
description: Set up s&box references and the editor connection (sbox-cli), consult the installed engine's XML docs, documentation, API pages and engine source, script the editor safely (lock, project check, deny list), apply proven working practices for coding agents on s&box projects (including multi-agent setups), and import Synty POLYGON assets. Use when starting or setting up an s&box project, doing engine-specific s&box work, driving the s&box editor from agents or scripts, handling an engine update, or importing Synty assets.
---

# s&box Context

Use official s&box references to ground engine-specific decisions, and reach the editor safely. This skill provides portable fetchers, the editor connection, a scripted editor client with a shared lock, a lookup workflow, and working practices learned on a long agent-driven s&box project. The downloaded snapshots belong to the user's project. Keep game references, architecture, and simulation/testing rules under that project's control: the project's own instructions override this skill's defaults.

## Connect the editor MCP server

Include the editor connection in normal project setup, unless the user requested only reference downloads. For MCP-only setup, skip snapshot downloads. Read [references/mcp-setup.md](references/mcp-setup.md) for the configuration, the read-only check, and troubleshooting.

Since engine 26.10.13 the editor has no HTTP server. `<engine>/bin/managed/sbox-cli.exe` ships with every installation and reaches a running editor or game over a per-user named pipe. Run from the project folder, it talks only to the editor that has that project open. Older editors served MCP on `http://127.0.0.1:7269/mcp`; the check keeps a `--url` mode for them. Configure or reuse the client's connection, verify the open project, and report configuration and live availability separately. A closed editor should not prevent completing reference setup.

Before editor operations, use `editor_status` to confirm the intended project is open. Discover tools with `search_tools` and invoke them with `call_tool`; read `read_console` after relevant operations. Keep editor mutations within the user's task. Automated editor checks supplement the user's final visual/gameplay validation.

## Script the editor (agents, tools, several runs)

For scripts, headless agent runs (which may refuse mutating MCP tools through the client's own entry), or more than one agent sharing an editor, use the bundled client instead of a raw MCP entry:

```text
node "<skill-dir>/scripts/editor-lock.js" take <HOLDER> --project-root "<game-folder>"
node "<skill-dir>/scripts/editor.js" <tool> '<json>' --project-root "<game-folder>" --holder <HOLDER>
node "<skill-dir>/scripts/editor.js" <tool> @args.json --out result.json   # JSON through a file (PowerShell 5.1)
node "<skill-dir>/scripts/editor-lock.js" release <HOLDER> --project-root "<game-folder>"
```

`editor.js` keeps one `sbox-cli --connect` session per process (import `openEditor` from Node for several calls), routes tools that are not top-level through `call_tool`, and before the first non-read-only tool checks that `editor_status` names the project root. It refuses tools listed under `deny` in the project's optional `sbox-editor.json` (`{"deny": ["save_scene"], "requireLock": true}`), including inside `call_tool` and `call_tools`. It refuses mutation while another holder's live lock exists, and refreshes the caller's own lock on each call. Exit codes: 0 ok, 2 tool error, 1 cannot call. `editor-lock.js` is exclusive and re-entrant; a lock goes stale after 15 minutes and is released only by its holder. Gitignore `.sbox-editor.lock`.

## Apply working practices

- When setting up a project, or when a question isn't covered by the project's instructions, read [references/project-practices.md](references/project-practices.md): reference order, editor access, C# and hot reload, Play-mode verification, Scene Compile and performance, exports and networking, Windows scripting, and the engine-update routine. Bring the rules that fit into the project's `AGENTS.md` instead of linking to this skill from shared files.
- For several agent runs (workers, reviewer, orchestrator) on one editor, also read [references/agent-workflow.md](references/agent-workflow.md), and start the project's worker instructions from [assets/worker-preamble.md](assets/worker-preamble.md).
- Don't overwrite a project's existing rules. Propose changes where they conflict.
- When importing or placing Synty POLYGON assets, read [references/synty-import.md](references/synty-import.md): which download to use, units and axes, `.vmdl`/`.vmat` recipes (glass, mirrors, cutout, emissive), collision, importer design, and measuring pitfalls.

## Use what the installed engine ships first

These match the installed build exactly and need no download. Locate `<engine>` as in [references/mcp-setup.md](references/mcp-setup.md).

- **XML API docs:** `<engine>/bin/managed/Sandbox.Engine.xml` (game code) and `Sandbox.Tools.xml` (editor code). They are the authority for whether a member exists on the installed build. Search them for `M:`, `P:` and `T:` names with targeted `rg`; never read the whole file.
- **Facepunch's agent guidance:** `sbox-cli --skill` lists the skills for this installation, and `sbox-cli --skill sbox-cli/references/<file>` prints one. The files are `tools.md` (toolsets), `protocol.md` (transport, limits, timeouts), `run-csharp.md` (trusted C# inside the editor), `project.md` (the compile and verify loop) and `authoring-tools.md` (`[McpTool]` project tools). Read them as reference. The project's own instructions override them: some projects forbid saving scenes or keep scene and prefab files generated from data, while the engine's guidance prefers editor tools and `save_scene`.
- The engine offers to install a small bootstrap skill (`sbox-cli --skill-install`, also prompted by the editor at startup). It tells agents to follow `sbox-cli --skill`. Install it only when the project wants that guidance applied as instructions. Otherwise answer the editor's prompt with "Don't ask again".

## Consult references

- Inspect the project's `AGENTS.md` and run `node "<skill-dir>/scripts/sbox-context.js" status --project-root "<project-root>"` to discover installed snapshots. Respect configured paths in `sbox-context.lock.json`; defaults are `docs/sbox-docs`, `docs/sbox-api`, and `reference/sbox-public`.
- Search documentation for concepts and recommended usage. Search API `types/` pages for exact types, signatures, and members; topic indexes help discovery but are heuristic groupings. Use targeted `rg` searches and file reads rather than loading an entire index or source tree.
- For engine/editor behavior the documentation does not explain, inspect the relevant public source. If source is absent and the investigation needs it, fetch only `source`. Treat implementation details as evidence about that revision, not automatically as supported game APIs.
- Check snapshot provenance before assuming a result applies to the installed engine. The website documentation, published API schema, source revision, and installed editor can differ; the installed XML docs settle member questions. The public source repository is a mirror whose commits do not carry the engine's build hashes (the editor's ProductVersion `1.0.1+<hash>` names an internal commit), so a source pin is "public HEAD near the release", not the exact build.
- Snapshot directories are usually gitignored, and `rg` and editor search tools skip ignored paths when searching from the repository root. Search a snapshot by naming its directory explicitly (`rg <pattern> reference/sbox-public`). Prefer project pins and installed templates for version-sensitive questions. Use official online pages when local material is missing or outdated; do not silently refresh a project's pinned snapshots.
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
- **The manifest `sbox-context.lock.json` describes the snapshots on this machine.** Either commit it together with the snapshots it describes, or ignore both. Never commit the manifest while ignoring the snapshots: two machines that fetch at different times then disagree about fingerprints, and each later refresh refuses to run or dirties the other's tree. For engine source shared across machines, a git submodule at the source path (shallow, pinned by the superproject's commit) is an alternative that git manages instead of this helper; leave `source` out of `--resources` then.
- During requested setup, merge the guidance in [assets/agents-snippet.md](assets/agents-snippet.md) into the existing `AGENTS.md`, adjusting paths and including source guidance when available. Preserve unrelated instructions. Add `.sbox-editor.lock` to `.gitignore`. If the project generates its scenes or prefabs, offer an `sbox-editor.json` that denies `save_scene`. If the project does not commit its references, add the generated snapshot directories, `sbox-context.lock.json`, `.sbox-context-stage-*/` and `.sbox-context-update.lock` to `.gitignore`. If it does commit them, ignore only the staging directories and the update lock.

Run `--help` for pacing and timeout options. If an upstream change breaks discovery or schema validation, retain the previous snapshot and investigate the official endpoint instead of generating an empty replacement. A Windows directory lock may require the user to close the process watching the snapshot before retrying.

After setup or refresh, report installed resources, paths, version identifiers, the installed engine's location and XML docs, MCP configuration/reachability and open-project checks, and any failures. Do not initialize a game, download unrelated reference implementations, build the engine source, or publish anything as part of reference setup. Editor checks through these scripts supplement the user's final visual and gameplay validation; name what still needs it.
