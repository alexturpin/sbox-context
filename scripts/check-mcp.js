#!/usr/bin/env node
import path from "node:path"
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import { findEngine } from "./engine.js"

const PROTOCOL = "2025-11-25"

/**
 * Read-only check through sbox-cli (engine 26.10.13 and later): list running instances, then call
 * editor_status for the project at projectRoot. sbox-cli talks to the editor over a per-user named
 * pipe; it picks the editor that has the project in its working directory open.
 */
export function checkCli({ projectRoot = process.cwd(), engine, run = runCli, timeoutMs = 30000 } = {}) {
  const located = engine ?? findEngine()
  if (!located) throw new Error("No s&box installation found (set FACEPUNCH_ENGINE or pass --engine)")
  if (!located.cli) throw new Error(`No sbox-cli in ${located.dir}; engines before 26.10.13 use the HTTP server (--url)`)
  const listed = run(located.cli, ["--list"], projectRoot, timeoutMs)
  if (listed.status !== 0) throw new Error(`sbox-cli --list failed: ${listed.stderr.trim()}`)
  const instances = JSON.parse(listed.stdout || "[]")
  if (!Array.isArray(instances)) throw new Error("sbox-cli --list did not return an array")
  const status = run(located.cli, ["--call", "editor_status"], projectRoot, timeoutMs)
  if (status.status !== 0) {
    const reason = status.stderr.trim() || `exit ${status.status}`
    throw new Error(`editor_status through sbox-cli failed: ${reason}${instances.length ? "" : " (no running editor or game was listed)"}`)
  }
  let editorStatus
  try { editorStatus = JSON.parse(status.stdout) } catch { throw new Error("editor_status did not return JSON") }
  return { transport: "sbox-cli", cli: located.cli, xmlDocs: located.xmlDocs, instances, editorStatus }
}

function runCli(cli, args, cwd, timeoutMs) {
  const result = spawnSync(cli, args, { cwd, encoding: "utf8", timeout: timeoutMs, windowsHide: true })
  if (result.error) throw result.error
  return result
}

export const DEFAULT_URL = "http://127.0.0.1:7269/mcp"

export function validateEndpoint(value) {
  const url = new URL(value)
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username || url.password || url.search || url.hash || url.pathname.replace(/\/$/, "") !== "/mcp") {
    throw new Error("Expected the editor's loopback HTTP /mcp URL")
  }
  return url
}

/** Legacy check for editors before 26.10.13, which served MCP over loopback HTTP. */
export async function checkMcp(value = DEFAULT_URL, options = {}) {
  const url = validateEndpoint(value)
  const request = options.fetch ?? fetch
  let session, protocol = PROTOCOL, nextId = 1
  async function rpc(method, params, notification = false) {
    const id = notification ? undefined : nextId++
    const response = await request(url, {
      method: "POST", redirect: "error",
      headers: {
        "Content-Type": "application/json", Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": protocol, ...(session ? { "Mcp-Session-Id": session } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id }), method, ...(params ? { params } : {}) }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
    })
    if (!response.ok) throw new Error(`MCP ${method} returned HTTP ${response.status}`)
    session = response.headers.get("mcp-session-id") ?? session
    if (notification) return
    const message = await response.json()
    if (message.jsonrpc !== "2.0" || message.id !== id) throw new Error(`Invalid MCP response to ${method}`)
    if (message.error) throw new Error(`MCP ${method}: ${message.error.message ?? "protocol error"}`)
    if (!Object.hasOwn(message, "result")) throw new Error(`Missing MCP result for ${method}`)
    return message.result
  }
  const initialized = await rpc("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "sbox-context-check", version: "1.0" } })
  if (initialized?.serverInfo?.name !== "sbox-editor") throw new Error("Endpoint is not the s&box editor MCP server (expected sbox-editor)")
  if (typeof initialized.protocolVersion !== "string") throw new Error("MCP server did not negotiate a protocol version")
  protocol = initialized.protocolVersion
  await rpc("notifications/initialized", undefined, true)
  const listed = await rpc("tools/list")
  if (!Array.isArray(listed?.tools) || listed.tools.some((tool) => typeof tool?.name !== "string")) throw new Error("Invalid MCP tools/list response")
  const tools = listed.tools.map((tool) => tool.name)
  let editorStatus = null
  if (tools.includes("editor_status")) {
    const result = await rpc("tools/call", { name: "editor_status", arguments: {} })
    if (result?.isError) throw new Error(`editor_status failed: ${JSON.stringify(result.content ?? [])}`)
    editorStatus = result?.structuredContent ?? result?.content ?? result
  }
  return { transport: "http", url: url.href, serverInfo: initialized.serverInfo, protocolVersion: protocol, tools, editorStatus }
}

export const HELP = `Usage: node check-mcp.js [--project-root <dir>] [--engine <sbox-dir>] [--timeout-ms 30000]
       node check-mcp.js --url http://127.0.0.1:7269/mcp     (editors before 26.10.13)
Read-only: lists running instances and calls editor_status through sbox-cli from the
project folder, or through the legacy HTTP endpoint with --url. No configuration writes.`

export async function main(args) {
  if (args.includes("--help") || args.includes("-h")) { console.log(HELP); return }
  const options = {}
  const flags = { "--url": "url", "--timeout-ms": "timeoutMs", "--project-root": "projectRoot", "--engine": "engine" }
  for (let i = 0; i < args.length; i++) {
    const key = flags[args[i]]
    if (!key || Object.hasOwn(options, key)) throw new Error(`Unknown or duplicate option: ${args[i]}`)
    const value = args[++i]
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${args[i - 1]}`)
    if (key === "timeoutMs") {
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 600000) throw new Error("--timeout-ms must be an integer between 1 and 600000")
      options.timeoutMs = Number(value)
    } else options[key] = value
  }
  if (options.url && (options.projectRoot || options.engine)) throw new Error("--url is the legacy HTTP check; it takes no --project-root or --engine")
  const result = options.url ? await checkMcp(options.url, { timeoutMs: options.timeoutMs }) :
    checkCli({ projectRoot: options.projectRoot ? path.resolve(options.projectRoot) : process.cwd(),
      engine: options.engine ? findEngine(options.engine) ?? undefined : undefined, timeoutMs: options.timeoutMs })
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`${error.message}\nOpen the intended project in the s&box editor (Project Settings > AI > Enable MCP Communication must be on), and run from the desktop session: the named pipe is not reachable from a remote SSH session.`)
    process.exitCode = 1
  })
}
