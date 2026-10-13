import test from "node:test"
import assert from "node:assert/strict"
import { checkMcp, validateEndpoint } from "../check-mcp.js"

function fixture(overrides = {}) {
  const requests = []
  return {
    requests,
    fetch: async (url, options) => {
      assert.equal(url.hostname, "127.0.0.1")
      assert.equal(options.method, "POST")
      assert.equal(options.redirect, "error")
      const message = JSON.parse(options.body)
      requests.push(message)
      const results = {
        initialize: { protocolVersion: "2025-06-18", serverInfo: { name: "sbox-editor", version: "fixture" } },
        "tools/list": { tools: [{ name: "editor_status" }, { name: "search_tools" }] },
        "tools/call": { structuredContent: { paths: { projectRoot: "C:/fixture/game" } } },
      }
      if (message.method === "notifications/initialized") {
        assert.equal(message.id, undefined)
        return new Response(null, { status: 202 })
      }
      if (message.method !== "initialize") {
        assert.equal(options.headers["MCP-Protocol-Version"], "2025-06-18")
        assert.equal(options.headers["Mcp-Session-Id"], "fixture-session")
      }
      const result = Object.hasOwn(overrides, message.method) ? overrides[message.method] : results[message.method]
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }), { headers: { "mcp-session-id": "fixture-session" } })
    },
  }
}

test("MCP check negotiates protocol, discovers tools, and only calls read-only editor status", async () => {
  const fake = fixture()
  const result = await checkMcp(undefined, { fetch: fake.fetch })
  assert.deepEqual(fake.requests.map((request) => request.method), ["initialize", "notifications/initialized", "tools/list", "tools/call"])
  assert.equal(fake.requests.at(-1).params.name, "editor_status")
  assert.equal(result.editorStatus.paths.projectRoot, "C:/fixture/game")
})

test("a different server is rejected before tool discovery", async () => {
  const fake = fixture({ initialize: { protocolVersion: "2025-06-18", serverInfo: { name: "other-server" } } })
  await assert.rejects(checkMcp(undefined, { fetch: fake.fetch }), /not the s&box/)
  assert.equal(fake.requests.length, 1)
})

test("MCP tool errors fail a connection's editor-status check", async () => {
  const fake = fixture({ "tools/call": { isError: true, content: [{ type: "text", text: "no project" }] } })
  await assert.rejects(checkMcp(undefined, { fetch: fake.fetch }), /editor_status failed.*no project/)
})

test("missing editor-status tools are reported without inventing a project check", async () => {
  const fake = fixture({ "tools/list": { tools: [{ name: "search_tools" }] } })
  const result = await checkMcp(undefined, { fetch: fake.fetch })
  assert.equal(result.editorStatus, null)
  assert.equal(fake.requests.length, 3)
})

test("probe only permits local editor endpoints", () => {
  for (const value of ["http://127.0.0.1:7269/mcp", "http://localhost:8000/mcp/", "http://[::1]:7269/mcp"]) assert.ok(validateEndpoint(value))
  for (const value of ["http://example.com/mcp", "http://user:pass@localhost/mcp", "http://localhost/api", "http://localhost/mcp?token=secret", "file:///mcp"]) assert.throws(() => validateEndpoint(value))
})

test("HTTP, JSON-RPC, and response-identity errors fail the probe", async () => {
  await assert.rejects(checkMcp(undefined, { fetch: async () => new Response(null, { status: 405 }) }), /HTTP 405/)
  await assert.rejects(checkMcp(undefined, { fetch: async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: "broken" } })) }), /MCP initialize: broken/)
  await assert.rejects(checkMcp(undefined, { fetch: async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 999, result: {} })) }), /Invalid MCP response/)
})

import { checkCli } from "../check-mcp.js"
import { findEngine } from "../engine.js"

const engine = { dir: "C:/sbox", cli: "C:/sbox/bin/managed/sbox-cli.exe", xmlDocs: ["C:/sbox/bin/managed/Sandbox.Engine.xml"] }

function cliFixture(replies) {
  const calls = []
  return { calls, run: (cli, args, cwd) => { calls.push({ cli, args, cwd }); return replies[args[0]] } }
}

test("sbox-cli check lists instances, then reads editor_status from the project folder only", () => {
  const fake = cliFixture({
    "--list": { status: 0, stdout: '[{"pid":4,"kind":"editor","project":"C:/game/game.sbproj"}]', stderr: "" },
    "--call": { status: 0, stdout: '{"Project":"game","ActiveScenePath":"scenes/main.scene"}', stderr: "" },
  })
  const result = checkCli({ projectRoot: "C:/game", engine, run: fake.run })
  assert.deepEqual(fake.calls.map((call) => call.args), [["--list"], ["--call", "editor_status"]])
  assert.ok(fake.calls.every((call) => call.cwd === "C:/game"))
  assert.equal(result.transport, "sbox-cli")
  assert.equal(result.instances.length, 1)
  assert.equal(result.editorStatus.ActiveScenePath, "scenes/main.scene")
})

test("sbox-cli failures name the cause, and an engine without sbox-cli points at the HTTP check", () => {
  const none = cliFixture({
    "--list": { status: 0, stdout: "[]", stderr: "" },
    "--call": { status: 1, stdout: "", stderr: "sbox-cli: No running editor has C:/game/game.sbproj open." },
  })
  assert.throws(() => checkCli({ projectRoot: "C:/game", engine, run: none.run }), /No running editor.*no running editor or game was listed/)
  assert.throws(() => checkCli({ engine: { dir: "C:/old", cli: null, xmlDocs: [] }, run: none.run }), /before 26\.10\.13.*--url/)
})

test("engine lookup prefers an explicit folder, then FACEPUNCH_ENGINE, then the user variable", () => {
  const present = new Set(["C:/a", "C:/b", "C:/b/bin/managed/sbox-cli.exe", "C:/b/bin/managed/Sandbox.Tools.xml"].map((p) => p.replaceAll("/", "\\")))
  const exists = (p) => present.has(p.replaceAll("/", "\\"))
  assert.equal(findEngine("C:/missing", { env: {}, readUserVariable: () => "C:/b", exists }), null)
  const fromEnv = findEngine(undefined, { env: { FACEPUNCH_ENGINE: "C:/b" }, readUserVariable: () => "C:/a", exists })
  assert.equal(fromEnv.dir, "C:/b")
  assert.ok(fromEnv.cli.endsWith("sbox-cli.exe") || fromEnv.cli.endsWith("sbox-cli"))
  assert.equal(fromEnv.xmlDocs.length, 1)
  assert.equal(findEngine(undefined, { env: {}, readUserVariable: () => "C:/a", exists }).cli, null)
})
