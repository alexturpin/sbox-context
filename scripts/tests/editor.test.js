import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { openEditor, ToolError, findSbproj } from "../editor.js"
import { isMine, refresh, release, status, take, tryTake } from "../editor-lock.js"

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-sbox-cli.js")

function project({ editorRoot } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "sbox-editor-"))
  writeFileSync(path.join(root, "game.sbproj"), "{}")
  const log = path.join(root, "calls.log")
  process.env.FAKE_LOG = log
  process.env.FAKE_ROOT = editorRoot ?? root
  const calls = () => readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line))
  return { root, calls, lock: path.join(root, ".sbox-editor.lock") }
}

const open = (root, options = {}) => openEditor({ projectRoot: root, command: process.execPath, prefixArgs: [FAKE], holder: undefined, ...options })

test("lock: exclusive, re-entrant, released only by its holder", async () => {
  const { lock } = project()
  assert.equal(tryTake("agent-a", { file: lock }), true)
  assert.equal(tryTake("agent-b", { file: lock }), false)
  assert.equal(tryTake("agent-a", { file: lock }), true)
  assert.equal(release("agent-b", { file: lock }), false)
  assert.equal(status({ file: lock }).holder, "agent-a")
  assert.equal(release("agent-a", { file: lock }), true)
  assert.equal(status({ file: lock }).held, false)
  assert.equal(await take("agent-b", { file: lock, wait: false }), true)
})

test("lock: a stale lock is taken over; refresh never acquires", () => {
  const { lock } = project()
  tryTake("agent-a", { file: lock })
  const old = new Date(Date.now() - 20 * 60 * 1000)
  utimesSync(lock, old, old)
  assert.equal(status({ file: lock }).stale, true)
  assert.equal(refresh("agent-a", { file: lock }), false)
  assert.equal(tryTake("agent-b", { file: lock }), true)
  assert.equal(isMine("agent-b", { file: lock }), true)
  assert.throws(() => tryTake("bad holder!", { file: lock }), /holder/)
})

test("waiting take gives up at its deadline", async () => {
  const { lock } = project()
  tryTake("agent-a", { file: lock })
  assert.equal(await take("agent-b", { file: lock, timeoutMs: 30, pollMs: 10 }), false)
})

test("editor: connects to the project's sbproj, initializes, routes non-top-level tools through call_tool", async () => {
  const { root, calls } = project()
  const editor = await open(root)
  try {
    assert.deepEqual(await editor.tool("scene_trace", { x: 1 }), { called: "scene_trace", args: { x: 1 } })
    assert.equal((await editor.tool("read_console", {})).called, "read_console")
  } finally { await editor.close() }
  const log = calls()
  assert.deepEqual(log[0].argv.slice(0, 2), ["--connect", path.join(root, "game.sbproj")])
  const methods = log.slice(1).map((m) => m.method)
  assert.deepEqual(methods.slice(0, 2), ["initialize", "notifications/initialized"])
  const toolCalls = log.filter((m) => m.method === "tools/call").map((m) => m.params.name)
  assert.deepEqual(toolCalls, ["editor_status", "call_tool", "read_console"], "identity check runs once before the first mutating tool")
})

test("editor: refuses a different open project before any mutating call", async () => {
  const { root, calls } = project({ editorRoot: "/somewhere/else" })
  const editor = await open(root)
  try {
    await assert.rejects(editor.tool("scene_trace"), /somewhere.*not/)
  } finally { await editor.close() }
  assert.equal(calls().filter((m) => m.params?.name === "call_tool").length, 0)
})

test("editor: tool errors surface as ToolError", async () => {
  const { root } = project()
  const editor = await open(root)
  try {
    await assert.rejects(editor.tool("fail_tool"), (error) => error instanceof ToolError && /boom/.test(error.message))
  } finally { await editor.close() }
})

test("editor: deny list, including inside call_tool and call_tools", async () => {
  const { root, calls } = project()
  const editor = await open(root, { config: { deny: ["save_scene"] } })
  try {
    await assert.rejects(editor.tool("save_scene"), /denied/)
    await assert.rejects(editor.tool("call_tool", { name: "save_scene", arguments: {} }), /denied/)
    await assert.rejects(editor.tool("call_tools", { calls: [{ Name: "scene_trace" }, { Name: "save_scene" }] }), /denied/)
  } finally { await editor.close() }
  assert.equal(calls().filter((m) => m.method === "tools/call").length, 0)
})

test("editor: another agent's live lock blocks mutating tools but not read-only ones", async () => {
  const { root, lock } = project()
  tryTake("someone-else", { file: lock })
  const editor = await open(root)
  try {
    assert.equal((await editor.tool("editor_status")).Project, "fixture")
    await assert.rejects(editor.tool("scene_trace"), /locked by someone-else/)
  } finally { await editor.close() }
})

test("editor: a holder must hold the lock, and each call refreshes it", async () => {
  const { root, lock } = project()
  const editor = await open(root, { holder: "agent-a" })
  try {
    await assert.rejects(editor.tool("scene_trace"), /not held by agent-a/)
    tryTake("agent-a", { file: lock })
    const old = new Date(Date.now() - 10 * 60 * 1000)
    utimesSync(lock, old, old)
    await editor.tool("scene_trace")
    assert.ok(status({ file: lock }).ageMs < 60 * 1000)
  } finally { await editor.close() }
})

test("editor: requireLock refuses unlocked mutation", async () => {
  const { root } = project()
  const editor = await open(root, { config: { requireLock: true } })
  try {
    await assert.rejects(editor.tool("scene_trace"), /requires an editor lock/)
  } finally { await editor.close() }
})

test("editor: per-call timeout", async () => {
  const { root } = project()
  const editor = await open(root, { identityCheck: false })
  try {
    await assert.rejects(editor.tool("hang", {}, 50), /timed out/)
  } finally { await editor.close() }
})

test("sbproj discovery needs exactly one project file", () => {
  const root = mkdtempSync(path.join(tmpdir(), "sbox-editor-"))
  assert.throws(() => findSbproj(root), /found 0/)
  writeFileSync(path.join(root, "a.sbproj"), "{}")
  writeFileSync(path.join(root, "b.sbproj"), "{}")
  assert.throws(() => findSbproj(root), /found 2/)
  assert.equal(findSbproj(root, "b.sbproj"), path.join(root, "b.sbproj"))
})
