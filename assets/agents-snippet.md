## s&box references

Use the `sbox-context` skill when preparing or consulting s&box references.

- `docs/sbox-docs`: official engine concepts and workflows.
- `docs/sbox-api`: generated API signatures and type/member documentation.
- `reference/sbox-public`: optional public engine/editor implementation reference.
- `sbox-context.lock.json`: snapshot paths, dates, API schema URL, source commit, and content fingerprints.

Consult docs and API for engine-specific work; inspect public source when those do not explain the behavior. Search only relevant files. Check provenance against the installed editor before relying on version-sensitive behavior. Reference snapshots are reading material, not game dependencies.

Document findings beside the affected project code. Rendering, input, networking, and final gameplay behavior require validation in the s&box editor; report what still needs user validation.
