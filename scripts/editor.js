#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { spawn as spawnProcess } from "node:child_process"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { findEngine } from "./engine.js"
import { lockPath, refresh, status as lockStatus } from "./editor-lock.js"

/**
 * Scripted access to a running s&box editor through sbox-cli (engine 26.10.13 and later).
 *
 * Why not only the client's own MCP entry: headless agent runs (for example `codex exec`) may refuse
 * mutating MCP tools, scripts need the same access as agents, and several agents sharing one editor
 * need a lock, an open-project check and a per-project deny list that a raw MCP entry cannot enforce.
 * This client keeps one `sbox-cli --connect <sbproj>` child per session and speaks the editor's
 * JSON-RPC over its stdin/stdout, one JSON object per line.
 */
export const PROTOCOL = "2025-11-25"
export const TOP_LEVEL = new Set(["editor_status", "search_tools", "read_console", "call_tool", "call_tools"])
export const READ_ONLY = new Set(["editor_status", "search_tools", "read_console"])
export const CONFIG_NAME = "sbox-editor.json"

export class ToolError extends Error {
  constructor(name, result) {
    super(`${name} failed: ${JSON.stringify(result?.content ?? result).slice(0, 4000)}`)
    this.result = result
  }
}

/** The project's `.sbproj`: the explicit one, else the only one in projectRoot. */
export function findSbproj(projectRoot, explicit) {
  if (explicit) return path.resolve(projectRoot, explicit)
  const found = readdirSync(projectRoot).filter((name) => name.toLowerCase().endsWith(".sbproj"))
  if (found.length !== 1) throw new Error(`Expected one .sbproj in ${projectRoot}, found ${found.length}; pass --sbproj`)
  return path.join(projectRoot, found[0])
}

/**
 * Optional project policy, `<project>/sbox-editor.json`:
 * { "deny": ["save_scene"], "lockFile": ".sbox-editor.lock", "requireLock": true }
 * `deny` names tools this client refuses; `requireLock` refuses non-read-only tools without a held lock.
 */
export function readConfig(projectRoot) {
  const file = path.join(projectRoot, CONFIG_NAME)
  if (!existsSync(file)) return {}
  const config = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, ""))
  if (config.deny !== undefined && !(Array.isArray(config.deny) && config.deny.every((n) => typeof n === "string"))) {
    throw new Error(`${CONFIG_NAME}: deny must be an array of tool names`)
  }
  return config
}

export function decode(result) {
  if (result == null) return null
  if (Object.hasOwn(result, "structuredContent")) return result.structuredContent
  const out = (result.content ?? []).map((item) => {
    if (item?.type !== "text") return item
    try { return JSON.parse(item.text) } catch { return item.text }
  })
  return out.length === 1 ? out[0] : out
}

function samePath(a, b) {
  const norm = (p) => path.resolve(String(p)).replace(/[\\/]+$/, "").replaceAll("\\", "/")
  return process.platform === "win32" ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b)
}

/** The project root an editor_status result names, whatever the casing of its fields. */
export function statusProjectRoot(status) {
  const paths = status?.Paths ?? status?.paths ?? {}
  return paths.ProjectRoot ?? paths.projectRoot ?? null
}

export async function openEditor({
  projectRoot = process.cwd(), sbproj, engine, command, prefixArgs = [], spawn = spawnProcess,
  holder = process.env.SBOX_EDITOR_LOCK_HOLDER || undefined, lockFile, identityCheck = true,
  config, timeoutMs = 120000, clientName = "sbox-context-editor",
} = {}) {
  projectRoot = path.resolve(projectRoot)
  const policy = config ?? readConfig(projectRoot)
  const deny = new Set(policy.deny ?? [])
  const lock = lockPath(projectRoot, lockFile ?? policy.lockFile ?? process.env.SBOX_EDITOR_LOCK)
  if (!command) {
    const located = findEngine(engine)
    if (!located?.cli) throw new Error("sbox-cli not found (s&box 26.10.13 or later; set FACEPUNCH_ENGINE or pass --engine)")
    command = located.cli
  }
  const project = findSbproj(projectRoot, sbproj)
  // Sessions idle between calls and bakes run for minutes: lift sbox-cli's idle and request limits
  // and keep per-call timeouts here instead.
  const child = spawn(command, [...prefixArgs, "--connect", project, "--idle-timeout", "86400", "--request-timeout", "3600"],
    { cwd: projectRoot, stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
  const pending = new Map()
  const stderr = []
  let nextId = 1, buffer = "", closed = false, exitError = null

  const failAll = (error) => {
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(error) }
    pending.clear()
  }
  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (chunk) => {
    buffer += chunk
    let index
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).replace(/^﻿/, "").trim()
      buffer = buffer.slice(index + 1)
      if (!line) continue
      let message
      try { message = JSON.parse(line) } catch { stderr.push(`stdout: ${line}`); continue }
      const entry = pending.get(message?.id)
      if (!entry) continue
      pending.delete(message.id)
      clearTimeout(entry.timer)
      if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message ?? JSON.stringify(message.error)}`))
      else entry.resolve(message.result)
    }
  })
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk) => { stderr.push(...chunk.split(/\r?\n/).filter(Boolean)); stderr.splice(0, Math.max(0, stderr.length - 50)) })
  const exited = new Promise((resolve) => child.on("close", (code) => {
    closed = true
    exitError = new Error(`sbox-cli exited (${code}): ${stderr.slice(-5).join(" | ") || "no output"}`)
    failAll(exitError)
    resolve(code)
  }))
  child.on("error", (error) => { exitError = error; failAll(error) })

  function send(message) {
    if (closed || exitError) throw exitError ?? new Error("sbox-cli session is closed")
    child.stdin.write(JSON.stringify(message) + "\n")
  }

  function rpc(method, params, timeout = timeoutMs) {
    const id = nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`${method} timed out after ${timeout} ms (the editor's main thread may be blocked)`))
      }, timeout)
      pending.set(id, { resolve, reject, timer, method })
      try { send({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) }) } catch (error) {
        clearTimeout(timer); pending.delete(id); reject(error)
      }
    })
  }

  async function close(graceMs = 5000) {
    if (!closed) {
      child.stdin.end()
      const timer = setTimeout(() => child.kill(), graceMs)
      await exited
      clearTimeout(timer)
    }
  }

  let initialized, status
  try {
    initialized = await rpc("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: clientName, version: "1" } }, Math.max(timeoutMs, 180000))
    send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })
  } catch (error) {
    await close(1000)
    throw error
  }

  async function raw(name, args = {}, timeout) {
    const result = TOP_LEVEL.has(name)
      ? await rpc("tools/call", { name, arguments: args }, timeout)
      : await rpc("tools/call", { name: "call_tool", arguments: { name, arguments: args } }, timeout)
    if (result?.isError) throw new ToolError(name, result)
    return decode(result)
  }

  async function guard(name, args) {
    // call_tools takes { calls: [{ Name, Arguments }] }; call_tool takes { name, arguments }.
    const names = name === "call_tools" ? (args?.calls ?? []).map((c) => c?.Name ?? c?.name ?? "?")
      : name === "call_tool" ? [args?.name ?? "?"] : [name]
    const refused = names.filter((n) => deny.has(n))
    if (refused.length) throw new Error(`${refused.join(", ")} is denied by this project's ${CONFIG_NAME}`)
    if (names.length && names.every((n) => READ_ONLY.has(n))) return
    if (holder) {
      if (!refresh(holder, { file: lock })) throw new Error(`Editor lock ${lock} is not held by ${holder}; take it first`)
    } else {
      const current = lockStatus({ file: lock })
      if (current.held && !current.stale) throw new Error(`Editor is locked by ${current.holder}; set SBOX_EDITOR_LOCK_HOLDER or pass --holder with your own lock`)
      if (policy.requireLock) throw new Error(`${CONFIG_NAME} requires an editor lock for ${name}; take one and pass --holder`)
    }
    if (identityCheck && !status) await checkProject()
  }

  async function checkProject() {
    status = await raw("editor_status", {})
    const root = statusProjectRoot(status)
    if (!root || !samePath(root, projectRoot)) {
      status = undefined
      throw new Error(`The connected editor has ${root ?? "an unknown project"} open, not ${projectRoot}`)
    }
    return status
  }

  async function tool(name, args = {}, timeout) {
    await guard(name, args)
    return raw(name, args, timeout)
  }

  return { initialized, rpc, tool, checkProject, close, stderr, project, lock }
}

export const HELP = `Usage: node editor.js <tool> [<json> | @<file.json>] [options]
       node editor.js tools/list | initialize | status
Calls one editor tool through sbox-cli. Top-level tools (editor_status, search_tools,
read_console, call_tool, call_tools) are called directly; any other name goes through call_tool.
Options:
  --project-root <dir>  game folder holding the .sbproj (default: current directory)
  --sbproj <file>       when the folder holds more than one .sbproj
  --engine <dir>        s&box install folder (default: FACEPUNCH_ENGINE, then Steam's)
  --holder <name>       your editor lock holder (or SBOX_EDITOR_LOCK_HOLDER); refreshed per call
  --lock <file>         lock file (default <project>/.sbox-editor.lock)
  --out <file>          write the result as JSON instead of printing it
  --timeout-ms <ms>     per-call timeout (default 120000)
  --no-identity-check   skip the editor_status open-project check before non-read-only tools
Exit 0 on success, 2 when the tool reports an error, 1 when the call cannot be made.
Pass JSON through @file from Windows PowerShell 5.1, which strips quotes from native arguments.`

export async function main(args) {
  if (!args.length || args.includes("--help") || args.includes("-h")) { console.log(HELP); return 0 }
  const options = {}
  const positional = []
  let out
  const flags = { "--project-root": "projectRoot", "--sbproj": "sbproj", "--engine": "engine", "--holder": "holder", "--lock": "lockFile", "--out": "out", "--timeout-ms": "timeoutMs" }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--no-identity-check") { options.identityCheck = false; continue }
    const key = flags[arg]
    if (key) {
      const value = args[++i]
      if (value === undefined) throw new Error(`Missing value for ${arg}`)
      if (key === "out") out = value
      else if (key === "timeoutMs") {
        if (!/^\d+$/.test(value) || Number(value) < 1) throw new Error("--timeout-ms must be a positive integer")
        options.timeoutMs = Number(value)
      } else options[key] = value
    } else if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`)
    else positional.push(arg)
  }
  const [name, json, ...extra] = positional
  if (extra.length) throw new Error("Too many arguments; quote the JSON or pass @file")
  const params = json === undefined ? {} : JSON.parse(json.startsWith("@") ? readFileSync(json.slice(1), "utf8").replace(/^﻿/, "") : json)
  const editor = await openEditor(options)
  try {
    let result
    if (name === "initialize") result = editor.initialized
    else if (name === "tools/list") result = await editor.rpc("tools/list", {})
    else if (name === "status") result = await editor.checkProject()
    else result = await editor.tool(name, params)
    const text = JSON.stringify(result, null, 2)
    if (out) { writeFileSync(out, text + "\n"); console.log(JSON.stringify({ saved: out })) } else console.log(text)
    return 0
  } catch (error) {
    if (error instanceof ToolError) { console.error(error.message); return 2 }
    throw error
  } finally {
    await editor.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code }, (error) => {
    console.error(`${error.message}\nThe editor must be running with this project open (Project Settings > AI > Enable MCP Communication on); run from the desktop session, not over SSH.`)
    process.exitCode = 1
  })
}
