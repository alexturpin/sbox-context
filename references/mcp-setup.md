# s&box editor MCP connection

Use this procedure for normal project setup, an MCP-only request, or a missing/broken editor connection. A references-only refresh does not need to change MCP configuration.

## sbox-cli (engine 26.10.13 and later)

The editor no longer serves HTTP. Every installation ships `sbox-cli`, an MCP bridge that connects to a running editor or game over a local named pipe. Find it at `<engine>/bin/managed/sbox-cli.exe`, where `<engine>` is the folder holding `sbox-dev.exe`:

1. the `FACEPUNCH_ENGINE` environment variable. The launcher sets it as a Windows **user** variable, so a shell started earlier may lack it: check `HKCU\Environment` too;
2. Steam's default folder, `C:\Program Files (x86)\Steam\steamapps\common\sbox`;
3. the folder of a running `sbox-dev.exe`;
4. otherwise, ask the user.

Do not write the resolved path into shared project files; it differs per machine.

How it picks an instance: run from the project folder (or below it), it finds the `.sbproj` and attaches only to the editor that has that project open. `--connect <pid|project>` picks one explicitly; `--list` prints the running instances as JSON. Connections are accepted unless **Project Settings > AI > Enable MCP Communication** is off. That setting is stored in the `.sbproj` as `"AI": { "EnableMcpCommunication": true }`, which the editor writes on first load; commit it. The pipe is per OS user. It was not reachable from a remote SSH session on the same account, only from the desktop session (scheduled tasks included). Run checks from there.

The JSON-RPC protocol and tool names are the same as the old HTTP server's: `initialize`, `tools/list`, `editor_status`, `search_tools`, `call_tool`, `read_console`, and the toolsets they lead to. The transport is one JSON object per line on stdin and stdout, with no byte-order mark. Diagnostics go to stderr. EOF on stdin disconnects and cancels pending work. The engine's own protocol notes: `sbox-cli --skill sbox-cli/references/protocol.md`.

Lifetimes matter:
- `--connect` and `--call` attach and leave the instance running;
- `--project` attaches to the open editor or **opens one that it owns and closes on exit, discarding unsaved work**;
- `--game` starts and owns a game.
Use `--connect` for an editor the user or a service keeps open.

## Configure the client

Inspect existing entries first (the project's `.codex/config.toml`, the user's Codex configuration, `claude mcp list`). Reuse an appropriate connection and its tool policies; avoid duplicates; respect an explicitly disabled entry unless the request includes enabling it. Replace an old `url = "http://127.0.0.1:7269/mcp"` entry: on 26.10.13 and later it can only fail.

Codex, project-scoped (merge into `.codex/config.toml`, preserving other settings):

```toml
[mcp_servers.sbox]
command = 'C:\Program Files (x86)\Steam\steamapps\common\sbox\bin\managed\sbox-cli.exe'
args = ["--connect", 'C:\path\to\game\game.sbproj']
enabled = true
required = false
```

Claude Code, run from the project folder (its working directory selects the project):

```text
claude mcp add sbox -- "<engine>/bin/managed/sbox-cli.exe" --connect
```

`required = false` allows work while the editor is closed; with `--connect` the server fails to start until the project's editor is open. Restart or reload the client's server after the editor restarts. Listing a configured entry does not prove connectivity. If tools do not appear in the current chat after configuration, reload the client's MCP servers or start a new chat.

Scripts that call the editor can skip client configuration altogether. One call: `sbox-cli --call <tool> '<json>'` (exit 0 on success, 2 when the tool reports an error, 1 when it cannot connect). A session: spawn `sbox-cli --connect <sbproj>` and speak JSON-RPC lines over its stdin and stdout. Windows PowerShell 5.1 strips double quotes from native arguments: pass JSON through a file (`run_csharp` takes `path`), an environment variable, or another shell.

## Verify the server and project

Prefer the connected tools: call the read-only `editor_status` and compare its `Project` and `Paths.ProjectRoot` with the intended game project, which may live below the repository root. Its `EngineVersion` names the installed build. Resolve a wrong-project result before any editor mutation.

Without connected tools, this read-only helper verifies the bridge independently:

```text
node "<skill-dir>/scripts/check-mcp.js" --project-root "<game-folder>"
node "<skill-dir>/scripts/check-mcp.js" --engine "D:\SteamLibrary\steamapps\common\sbox" --project-root "<game-folder>"
node "<skill-dir>/scripts/check-mcp.js" --url "http://127.0.0.1:7269/mcp"      # editors before 26.10.13
```

It runs `sbox-cli --list` and `sbox-cli --call editor_status` from the project folder, and reports the instances, the status and the installed XML docs. It never writes configuration, enters play mode or starts an editor.

If it fails, finish the authorized reference and configuration work and state the remaining action. "No running editor has <project> open" means the editor is closed, still loading (the pipe appears once the project has loaded), open on another project, or reached from the wrong session. Also check that **Enable MCP Communication** is on. Startup failures are in `<engine>/logs`. Do not retry in a loop.

Once connected, read the server's initialization instructions, use `search_tools` for live tool schemas, invoke via `call_tool` (or `call_tools` for an ordered batch), and inspect `read_console` for relevant errors. Tool `isError` results are failures. A call that waits more than 30 s for the editor's main thread is cancelled and reported as the editor being blocked. Keep final visual/gameplay validation with the user and report the exact checks performed.

## Sources

- The engine's own skill: `sbox-cli --skill` (version-matched; `protocol.md`, `tools.md`).
- Public implementation: `engine/Launcher/SboxCli/` and `engine/Sandbox.Tools/Mcp/` in a `reference/sbox-public` snapshot.
- [s&box 26.10.13 release notes](https://sbox.game/news/rethinking) (the "Removed" list: the fixed-port HTTP server and its settings page gave way to sbox-cli).
