## s&box references

Use the `sbox-context` skill when preparing or consulting s&box references.

- `docs/sbox-docs`: official engine concepts and workflows.
- `docs/sbox-api`: generated API signatures and type/member documentation.
- `reference/sbox-public`: optional public engine/editor implementation reference.
- `sbox-context.lock.json`: snapshot paths, dates, API schema URL, source commit, and content fingerprints for this machine's snapshots (committed with them, or ignored with them).
- `<engine>/bin/managed/Sandbox.Engine.xml` and `Sandbox.Tools.xml`: the installed build's own API docs, the authority on whether a member exists.

Consult docs and API for engine-specific work; inspect public source when those do not explain the behavior. Search only relevant files, naming the snapshot directory explicitly: searches from the repository root skip ignored directories. Check provenance against the installed editor before relying on version-sensitive behavior. Reference snapshots are reading material, not game dependencies.

Document findings beside the affected project code. Rendering, input, networking, and final gameplay behavior require validation in the s&box editor; report what still needs user validation.

## s&box editor MCP

Reach the running editor through `<engine>/bin/managed/sbox-cli.exe` (engine 26.10.13 and later; earlier editors served `http://127.0.0.1:7269/mcp`). Run from the project folder, it attaches to the editor that has this project open. The client entry belongs in the project's `.codex/config.toml` (`command` = the sbox-cli path, `args = ["--connect", "<sbproj>"]`), unless an existing user connection is reused. Facepunch's version-matched guidance is printed by `sbox-cli --skill`; this file's rules override it.

Use `editor_status` to confirm the intended game project is open before editor operations. Discover live tools with `search_tools`, invoke them through `call_tool`, and check `read_console` for relevant errors. The connection works only while the editor runs, so distinguish a configured connection from one actually verified. Editor checks supplement the user's final visual/gameplay validation.
