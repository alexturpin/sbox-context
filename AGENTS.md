# sbox-context

This repository is a standalone skill. Keep `SKILL.md` focused on acquiring and consulting s&box references and configuring the built-in editor MCP connection, with helpers in `scripts/` and a mergeable project guidance snippet in `assets/`.

Use Node built-ins and explicit project roots. Downloaded references belong in the target project, never this skill checkout. Preserve snapshots on acquisition/publication failures and refuse updates that would overwrite local edits. Keep source/API pins and provenance visible. Do not bundle upstream docs/source or unrelated game references into the skill.

When changing a fetcher, run `node --test scripts/tests/*.test.js` and check relevant CLI behavior. Tests use fixtures and temporary directories, not a live game's snapshots. For changes to upstream discovery, check the official endpoint separately and report the live check's scope. Validate skill frontmatter with the skill-creator validator when available.

MCP setup uses the editor's existing local server. Keep the probe read-only, verify server identity, distinguish configuration from connectivity, and confirm the open project before editor mutations. Preserve other Codex configuration and tool policies.
