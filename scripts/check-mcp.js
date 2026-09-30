#!/usr/bin/env node
import path from "node:path"
import { pathToFileURL } from "node:url"

export const DEFAULT_URL = "http://127.0.0.1:7269/mcp"
const PROTOCOL = "2025-11-25"

export function validateEndpoint(value) {
  const url = new URL(value)
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username || url.password || url.search || url.hash || url.pathname.replace(/\/$/, "") !== "/mcp") {
    throw new Error("Expected the editor's loopback HTTP /mcp URL")
  }
  return url
}

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
  return { url: url.href, serverInfo: initialized.serverInfo, protocolVersion: protocol, tools, editorStatus }
}

export async function main(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: node check-mcp.js [--url http://127.0.0.1:7269/mcp] [--timeout-ms 5000]\nRead-only MCP initialization, tool discovery, and editor status. No configuration writes.")
    return
  }
  let url = DEFAULT_URL, timeoutMs = 5000
  const seen = new Set()
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    if (!["--url", "--timeout-ms"].includes(flag) || seen.has(flag)) throw new Error(`Unknown or duplicate option: ${flag}`)
    seen.add(flag)
    const value = args[++i]
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${flag}`)
    if (flag === "--url") url = value
    else {
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > 60000) throw new Error("--timeout-ms must be an integer between 1 and 60000")
      timeoutMs = Number(value)
    }
  }
  console.log(JSON.stringify(await checkMcp(url, { timeoutMs }), null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`${error.message}\nOpen the intended s&box project and check Editor → Preferences → MCP Server for enablement, URL, and running status.`)
    process.exitCode = 1
  })
}
