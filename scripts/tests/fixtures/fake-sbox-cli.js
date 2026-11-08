// Stands in for sbox-cli --connect: one JSON-RPC object per line on stdin and stdout.
import { appendFileSync } from "node:fs"
import { createInterface } from "node:readline"

const log = (value) => process.env.FAKE_LOG && appendFileSync(process.env.FAKE_LOG, JSON.stringify(value) + "\n")
log({ argv: process.argv.slice(2), cwd: process.cwd() })
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n")
for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line)
  log(message)
  if (message.id === undefined) continue
  if (message.method === "initialize") reply(message.id, { protocolVersion: "2025-11-25", serverInfo: { name: "sbox-editor" } })
  else if (message.method === "tools/list") reply(message.id, { tools: [{ name: "editor_status" }] })
  else if (message.method === "tools/call") {
    const { name, arguments: args } = message.params
    const inner = name === "call_tool" ? args.name : name
    if (inner === "editor_status") reply(message.id, { structuredContent: { Project: "fixture", Paths: { ProjectRoot: process.env.FAKE_ROOT } } })
    else if (inner === "fail_tool") reply(message.id, { isError: true, content: [{ type: "text", text: "boom" }] })
    else if (inner === "hang") { /* never answers */ }
    else reply(message.id, { content: [{ type: "text", text: JSON.stringify({ called: inner, args: name === "call_tool" ? args.arguments : args }) }] })
  }
}
