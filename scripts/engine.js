import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"

const STEAM_DEFAULT = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\sbox"

// The launcher sets FACEPUNCH_ENGINE as a Windows user variable, which a shell started
// earlier may not have yet; read the registry as the engine's own skill advises.
function userVariable(name) {
  if (process.platform !== "win32") return undefined
  const result = spawnSync("reg", ["query", "HKCU\\Environment", "/v", name], { encoding: "utf8" })
  const match = result.status === 0 ? result.stdout.match(new RegExp(`${name}\\s+REG_\\w+\\s+(.+)`)) : null
  return match?.[1].trim()
}

/**
 * Locate the installed s&box engine and the version-matched files it ships:
 * sbox-cli (the editor MCP bridge since 26.10.13), the XML API docs, and the logs.
 * Order: an explicit directory, FACEPUNCH_ENGINE (process, then user scope), Steam's default folder.
 */
export function findEngine(explicit, { env = process.env, readUserVariable = userVariable, exists = existsSync } = {}) {
  const candidates = explicit ? [explicit] : [env.FACEPUNCH_ENGINE, readUserVariable("FACEPUNCH_ENGINE"), STEAM_DEFAULT]
  for (const dir of candidates.filter(Boolean)) {
    const managed = path.join(dir, "bin", "managed")
    const cli = path.join(managed, process.platform === "win32" ? "sbox-cli.exe" : "sbox-cli")
    if (!exists(dir)) continue
    return {
      dir,
      cli: exists(cli) ? cli : null,
      xmlDocs: ["Sandbox.Engine.xml", "Sandbox.Tools.xml"].map((name) => path.join(managed, name)).filter((file) => exists(file)),
      logs: path.join(dir, "logs"),
    }
  }
  return null
}
