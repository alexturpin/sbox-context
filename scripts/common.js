import fs from "node:fs/promises"
import { createReadStream } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import { spawn } from "node:child_process"

export const USER_AGENT = "sbox-context/1.0 (local developer reference fetcher)"
export const MANIFEST = "sbox-context.lock.json"
export const UPDATE_LOCK = ".sbox-context-update.lock"
export const DEFAULT_PATHS = { docs: "docs/sbox-docs", api: "docs/sbox-api", source: "reference/sbox-public" }

export function assertWithin(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Expected a path strictly inside ${root}: ${target}`)
  }
  return target
}

export async function exists(target) {
  try { await fs.lstat(target); return true }
  catch (error) { if (error.code === "ENOENT") return false; throw error }
}

export async function assertNoLinks(root, target) {
  assertWithin(root, target)
  let cursor = root
  for (const segment of path.relative(root, target).split(path.sep)) {
    cursor = path.join(cursor, segment)
    try {
      if ((await fs.lstat(cursor)).isSymbolicLink()) throw new Error(`Refusing symlink or junction: ${cursor}`)
    } catch (error) { if (error.code !== "ENOENT") throw error }
  }
}

export async function removeWithin(root, target) {
  assertWithin(root, target)
  await assertNoLinks(root, target)
  await fs.rm(target, { recursive: true, force: true })
}

export function resolvePaths(root, overrides = {}, manifest = { resources: {} }) {
  const paths = {}
  for (const [resource, fallback] of Object.entries(DEFAULT_PATHS)) {
    const relative = overrides[resource] ?? manifest.resources?.[resource]?.path ?? fallback
    if (typeof relative !== "string" || !relative || path.isAbsolute(relative) || path.win32.isAbsolute(relative)) {
      throw new Error(`${resource} path must be relative to the project root`)
    }
    const absolute = assertWithin(root, path.resolve(root, relative))
    const segments = path.relative(root, absolute).split(path.sep)
    if (segments.some((part) => [".git", ".agents", ".codex"].includes(part.toLowerCase())) ||
      segments[0].startsWith(".sbox-context-stage-") || [MANIFEST, UPDATE_LOCK].includes(segments[0])) {
      throw new Error(`Reserved reference path: ${relative}`)
    }
    paths[resource] = absolute
  }
  const entries = Object.entries(paths)
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const relative = path.relative(entries[i][1], entries[j][1])
      const reverse = path.relative(entries[j][1], entries[i][1])
      const inside = (value) => !value || (value !== ".." && !value.startsWith(`..${path.sep}`) && !path.isAbsolute(value))
      if (inside(relative) || inside(reverse)) throw new Error("Reference paths must be disjoint")
    }
  }
  return paths
}

export async function readManifest(root) {
  const location = path.join(root, MANIFEST)
  await assertNoLinks(root, location)
  if (!await exists(location)) return { schemaVersion: 1, resources: {} }
  const manifest = JSON.parse(await fs.readFile(location, "utf8"))
  if (manifest.schemaVersion !== 1 || !manifest.resources || Array.isArray(manifest.resources) || typeof manifest.resources !== "object") {
    throw new Error(`Unsupported or malformed ${MANIFEST}`)
  }
  for (const [name, record] of Object.entries(manifest.resources)) {
    if (!Object.hasOwn(DEFAULT_PATHS, name) || !record || typeof record.path !== "string" ||
      typeof record.fetchedAt !== "string" || !/^[a-f0-9]{64}$/.test(record.contentSha256 ?? "")) {
      throw new Error(`Malformed manifest entry: ${name}`)
    }
  }
  resolvePaths(root, {}, manifest)
  return manifest
}

export async function fingerprint(directory) {
  const tree = createHash("sha256")
  let files = 0
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true })
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    for (const entry of entries) {
      const location = path.join(current, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Reference tree contains a symlink: ${location}`)
      const relative = path.relative(directory, location).split(path.sep).join("/")
      if (entry.isDirectory()) {
        tree.update(`directory\0${relative}\0`)
        await walk(location)
      } else if (entry.isFile()) {
        const file = createHash("sha256")
        for await (const chunk of createReadStream(location)) file.update(chunk)
        tree.update(`file\0${relative}\0${file.digest("hex")}\0`)
        files++
      } else throw new Error(`Unsupported reference file: ${location}`)
    }
  }
  await walk(directory)
  return { contentSha256: tree.digest("hex"), files }
}

export function assertOfficialApiUrl(value) {
  const url = new URL(value)
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash ||
    !["sbox.game", "cdn.sbox.game"].includes(url.hostname) || !url.pathname.endsWith(".json")) {
    throw new Error("API URL must be an HTTPS .json URL on sbox.game or cdn.sbox.game")
  }
}

export async function fetchText(value, options = {}) {
  const url = new URL(value)
  let lastError
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/markdown,application/json,text/html,text/plain;q=0.9,*/*;q=0.8" },
        signal: AbortSignal.timeout(options.timeoutMs ?? 30000),
      })
      const finalUrl = new URL(response.url)
      if (finalUrl.protocol !== "https:" || !["sbox.game", "cdn.sbox.game"].includes(finalUrl.hostname)) {
        throw new Error(`Unexpected redirect outside official reference hosts: ${response.url}`)
      }
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status} fetching ${url.href}`)
        error.retryable = response.status === 429 || response.status >= 500
        const seconds = Number(response.headers.get("retry-after"))
        error.delayMs = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 10000) : undefined
        throw error
      }
      return await response.text()
    } catch (error) {
      lastError = error
      const transportError = error instanceof TypeError || ["TimeoutError", "AbortError"].includes(error.name)
      if (attempt === 2 || !(error.retryable || transportError)) break
      await new Promise((resolve) => setTimeout(resolve, error.delayMs ?? 1000 * (attempt + 1)))
    }
  }
  throw lastError
}

export function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
    let stdout = "", stderr = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("error", reject)
    child.on("close", (code, signal) => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(`${command} failed (${signal ?? code}): ${stderr.trim()}`))
    })
  })
}

export async function synchronizeResource(root, resource, destination, builder, options = {}) {
  const lockPath = path.join(root, UPDATE_LOCK)
  await assertNoLinks(root, lockPath)
  let lock
  try { lock = await fs.open(lockPath, "wx") }
  catch (error) {
    if (error.code === "EEXIST") throw new Error(`Another update owns ${lockPath}; if its process exited, inspect and remove the stale lock before retrying`)
    throw error
  }
  try {
    await lock.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`)
    return await synchronizeUnlocked(root, resource, destination, builder, options)
  } finally {
    await lock.close()
    await assertNoLinks(root, lockPath)
    await fs.unlink(lockPath)
  }
}

async function synchronizeUnlocked(root, resource, destination, builder, options) {
  assertWithin(root, destination)
  await assertNoLinks(root, destination)
  const manifest = await readManifest(root)
  const previous = manifest.resources[resource]
  const relativePath = path.relative(root, destination).split(path.sep).join("/")
  const hasPrevious = await exists(destination)
  let previousHash
  if (hasPrevious) {
    if (!(await fs.lstat(destination)).isDirectory()) throw new Error(`Reference path is not a directory: ${destination}`)
    if (previous && previous.path !== relativePath) throw new Error(`Manifest already owns ${resource} at ${previous.path}; preserve/migrate it before changing paths`)
    if (!previous && !options.adopt) throw new Error(`Unmanaged snapshot at ${destination}; inspect it before using --adopt`)
    previousHash = (await fingerprint(destination)).contentSha256
    if (previous && previousHash !== previous.contentSha256) throw new Error(`Local edits detected in ${destination}; preserve them before refreshing`)
  } else if (previous && previous.path !== relativePath) {
    throw new Error(`Manifest already records ${resource} at ${previous.path}; migrate the entry before changing paths`)
  }
  const work = await fs.mkdtemp(path.join(root, ".sbox-context-stage-"))
  const staged = path.join(work, "snapshot")
  const backup = path.join(work, "previous")
  const manifestFile = path.join(root, MANIFEST)
  const pendingManifest = path.join(work, MANIFEST)
  let backedUp = false, published = false, retainWork = false
  try {
    await fs.mkdir(staged)
    const metadata = await builder(staged)
    const hash = await fingerprint(staged)
    if (!hash.files) throw new Error(`Refusing empty ${resource} snapshot`)
    const latest = await readManifest(root)
    if (JSON.stringify(latest) !== JSON.stringify(manifest)) throw new Error("Manifest changed during download; retry after the other update completes")
    await assertNoLinks(root, destination)
    if (hasPrevious) {
      if ((await fingerprint(destination)).contentSha256 !== previousHash) throw new Error("Reference changed during download; refusing to replace it")
    } else if (await exists(destination)) throw new Error("Reference appeared during download; refusing to replace it")
    latest.resources[resource] = { ...metadata, path: relativePath, fetchedAt: new Date().toISOString(), ...hash }
    await fs.writeFile(pendingManifest, `${JSON.stringify(latest, null, 2)}\n`)
    await fs.mkdir(path.dirname(destination), { recursive: true })
    if (hasPrevious) { await fs.rename(destination, backup); backedUp = true }
    await fs.rename(staged, destination)
    published = true
    // The old manifest stays in place until the snapshot can be committed.
    await fs.rename(pendingManifest, manifestFile)
    console.log(`Installed ${resource}: ${destination} (${hash.files} files)`)
    return latest.resources[resource]
  } catch (error) {
    try {
      if (published) await removeWithin(root, destination)
      if (backedUp) await fs.rename(backup, destination)
    } catch (rollbackError) {
      retainWork = true
      throw new Error(`${error.message}; rollback failed: ${rollbackError.message}. Preserved recovery files at ${work}`)
    }
    throw error
  } finally {
    if (!retainWork) await removeWithin(root, work)
  }
}
