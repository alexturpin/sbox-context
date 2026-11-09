import { realpathSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * True when the module at `metaUrl` is the script Node was started with.
 *
 * Node resolves symlinks for `import.meta.url` but not for `process.argv[1]`, so a plain URL
 * comparison is false when a script is run through a symlinked folder (a skill directory linked
 * into `~/.claude/skills`, for example). The script then skips `main` and exits 0 having done
 * nothing. Compare real paths instead, case-insensitively on Windows.
 */
export function isEntryPoint(metaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false
  const real = (file) => {
    try { return realpathSync(file) } catch { return path.resolve(file) }
  }
  const self = real(fileURLToPath(metaUrl))
  const started = real(path.resolve(argv1))
  return process.platform === "win32" ? self.toLowerCase() === started.toLowerCase() : self === started
}
