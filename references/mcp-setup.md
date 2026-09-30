# s&box editor MCP connection

Use this procedure for normal project setup, an MCP-only request, or a missing/broken editor connection. A references-only refresh does not need to change MCP configuration.

## Server and endpoint

The server is embedded in the s&box editor and operates on its currently open project. Open the intended project in the editor. **Editor → Preferences → MCP Server** shows enablement, running status, and the URL; use **Copy Url** for a custom port. The documented default is `http://127.0.0.1:7269/mcp`, enabled by default. Confirm against the installed editor rather than assuming every version has the feature.

No npm package, separate server installation, authentication flow, or engine-source build is needed. Keep the connection local to this machine.

## Configure Codex

1. Inspect relevant MCP entries in the project's `.codex/config.toml` and the user's Codex configuration. Reuse an appropriate existing connection, endpoint, and tool policies; avoid duplicate registrations. Respect an explicitly disabled connection unless the current request includes enabling it.
2. For requested project setup, merge this entry into the project's `.codex/config.toml`, preserving other settings. Use the copied editor URL if it differs. Codex loads project configuration for trusted projects.

```toml
[mcp_servers.sbox]
url = "http://127.0.0.1:7269/mcp"
enabled = true
required = false
```

`required = false` allows work when the editor is closed. An unreachable editor is still an incomplete live connection check and must be reported as such. Reuse an existing server name rather than requiring it to be `sbox`.

For an explicitly requested connection across all projects, the alternative is `codex mcp add sbox --url http://127.0.0.1:7269/mcp`, or **Settings → MCP servers → Add server** with Streamable HTTP. Those change user configuration; project setup normally uses the project entry above.

3. Check effective configuration with `codex mcp get sbox` or `codex mcp list` from the target project when the CLI is available. Listing a configured entry does not prove connectivity. If tools are not exposed to the current chat after configuration, use the client's MCP restart/reload control or start a new chat; restart Codex if necessary. Do not claim live Codex tool integration from a standalone HTTP probe alone.

## Verify the server and project

Prefer the connected MCP tools: call the read-only `editor_status` and compare its project root/name to the intended game project. The game project may live below the repository root, such as `game/`; compare to the actual project, not merely the repo's folder name. Before any editor mutations, resolve a wrong-project result with the user or the authorized editor workflow.

If the chat has no connected tools yet, this read-only helper independently verifies the endpoint:

```text
node "<skill-dir>/scripts/check-mcp.js"
node "<skill-dir>/scripts/check-mcp.js" --url "http://127.0.0.1:<port>/mcp"
```

It performs MCP initialization and tool discovery, confirms the `sbox-editor` identity, and calls `editor_status` if listed. It does not modify scenes, enter play mode, start the editor, or write configuration. Inspect the reported editor status to verify the open project. The probe uses the plain JSON Streamable HTTP responses implemented by the editor; it is not a general-purpose MCP client.

If unavailable, finish the authorized reference/configuration work and state the remaining action: open the intended project, enable MCP in editor preferences if needed, confirm the port/running status, and reload the Codex connection. HTTP GET may return **405** because the editor accepts MCP JSON-RPC **POST** requests; do not use a browser GET as a failed-server test. If initialization names another server, stop using that endpoint and check the editor URL. Connection refusal usually means a closed editor, disabled server, changed port, or startup error; inspect editor MCP preferences and console instead of repeatedly retrying.

Once connected, read the server's initialization instructions, use `search_tools` for live tool schemas, invoke via `call_tool`, and inspect `read_console` for relevant errors. Tool `isError` results are failures even when the HTTP request succeeds. Keep final visual/gameplay validation with the user and report the exact checks performed.

## Sources

- [Official s&box MCP documentation](https://sbox.game/dev/doc/editor/mcp-server)
- [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp)
- Public implementation: `engine/Sandbox.Tools/Mcp/McpServer.cs`, `TopLevelTools.cs`, and `README.md` in an optional `reference/sbox-public` snapshot.
