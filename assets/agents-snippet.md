## s&box references

Use the `sbox-context` skill when preparing or consulting s&box references.

- `docs/sbox-docs`: official engine concepts and workflows.
- `docs/sbox-api`: generated API signatures and type/member documentation.
- `reference/sbox-public`: optional public engine/editor implementation reference.
- `sbox-context.lock.json`: snapshot paths, dates, API schema URL, source commit, and content fingerprints.

Consult docs and API for engine-specific work; inspect public source when those do not explain the behavior. Search only relevant files. Check provenance against the installed editor before relying on version-sensitive behavior. Reference snapshots are reading material, not game dependencies.

Document findings beside the affected project code. Rendering, input, networking, and final gameplay behavior require validation in the s&box editor; report what still needs user validation.

## s&box editor MCP

Connect Codex to the editor's built-in MCP server, normally `http://127.0.0.1:7269/mcp`. The endpoint is shown in **Editor → Preferences → MCP Server**. The connection belongs in the project's `.codex/config.toml`, unless an existing user connection is reused.

Use `editor_status` to confirm the intended game project is open before editor operations. Discover live tools with `search_tools`, invoke them through `call_tool`, and check `read_console` for relevant errors. The server is available while the editor is running; distinguish a configured connection from one actually verified. Editor checks supplement the user's final visual/gameplay validation.
