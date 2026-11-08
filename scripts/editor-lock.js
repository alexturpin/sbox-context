#!/usr/bin/env node
import { closeSync, openSync, readFileSync, renameSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

/**
 * One driver for a shared s&box editor at a time.
 *
 * The lock is a small JSON file (default `<project>/.sbox-editor.lock`, gitignored) naming its holder.
 * A lock younger than `staleMs` (file modification time) belongs to its holder; an older one may be
 * taken over. Taking a lock you already hold refreshes it (re-entrant). Release removes the file only
 * when it names you, so a failed take followed by an unconditional release never frees another
 * agent's lock. Creation is exclusive (`wx`), so two takers racing for a free lock cannot both win;
 * a stale lock is replaced and read back to confirm the holder.
 */
export const DEFAULT_LOCK_NAME = ".sbox-editor.lock"
export const DEFAULT_STALE_MS = 15 * 60 * 1000

export function lockPath(projectRoot = process.cwd(), explicit = process.env.SBOX_EDITOR_LOCK) {
  return explicit ? path.resolve(projectRoot, explicit) : path.join(projectRoot, DEFAULT_LOCK_NAME)
}

function checkHolder(holder) {
  if (typeof holder !== "string" || !/^[A-Za-z0-9._:-]{1,64}$/.test(holder)) {
    throw new Error("Lock holder must be 1-64 characters of letters, digits, '.', '_', ':' or '-'")
  }
  return holder
}

function read(file, now) {
  let text, stat
  try {
    text = readFileSync(file, "utf8")
    stat = statSync(file)
  } catch (error) {
    if (error.code === "ENOENT") return null
    throw error
  }
  let holder = null
  try { holder = JSON.parse(text).holder ?? null } catch { holder = text.trim().split(/\s+/)[0] || null }
  return { holder, ageMs: Math.max(0, now() - stat.mtimeMs), text }
}

function body(holder, now) {
  return JSON.stringify({ holder, taken: new Date(now()).toISOString(), pid: process.pid }) + "\n"
}

export function status({ file = lockPath(), staleMs = DEFAULT_STALE_MS, now = Date.now } = {}) {
  const current = read(file, now)
  if (!current) return { file, held: false }
  return { file, held: true, holder: current.holder, ageMs: Math.round(current.ageMs), stale: current.ageMs >= staleMs }
}

/** One attempt. Returns true when `holder` holds the lock afterwards. */
export function tryTake(holder, { file = lockPath(), staleMs = DEFAULT_STALE_MS, now = Date.now } = {}) {
  checkHolder(holder)
  try {
    const fd = openSync(file, "wx")
    try { writeFileSync(fd, body(holder, now)) } finally { closeSync(fd) }
    return true
  } catch (error) {
    if (error.code !== "EEXIST") throw error
  }
  const current = read(file, now)
  if (!current) return tryTake(holder, { file, staleMs, now })
  if (current.holder === holder) {
    writeFileSync(file, body(holder, now))
    return true
  }
  if (current.ageMs < staleMs) return false
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temp, body(holder, now))
  renameSync(temp, file)
  return read(file, now)?.holder === holder
}

export async function take(holder, { wait = true, timeoutMs = 60 * 60 * 1000, pollMs = 15000, sleep, log = () => {}, ...options } = {}) {
  const pause = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (tryTake(holder, options)) return true
    if (!wait || Date.now() >= deadline) return false
    const current = status(options)
    log(`editor lock held by ${current.holder ?? "?"} for ${Math.round((current.ageMs ?? 0) / 1000)} s; waiting`)
    await pause(Math.min(pollMs, Math.max(0, deadline - Date.now())))
  }
}

export function isMine(holder, { file = lockPath(), staleMs = DEFAULT_STALE_MS, now = Date.now } = {}) {
  const current = read(file, now)
  return Boolean(current && current.holder === holder && current.ageMs < staleMs)
}

/** Keep a held lock fresh during long work. Never acquires: a lost lock is reported, not reclaimed. */
export function refresh(holder, options = {}) {
  const file = options.file ?? lockPath()
  if (!isMine(holder, { ...options, file })) return false
  const at = new Date((options.now ?? Date.now)())
  utimesSync(file, at, at)
  return true
}

export function release(holder, { file = lockPath(), now = Date.now } = {}) {
  checkHolder(holder)
  const current = read(file, now)
  if (!current || current.holder !== holder) return false
  unlinkSync(file)
  return true
}

export const HELP = `Usage: node editor-lock.js take <holder> [--no-wait] [--timeout-ms <ms>]
       node editor-lock.js release <holder>
       node editor-lock.js refresh <holder>
       node editor-lock.js status
Options: --project-root <dir> (default: current directory), --lock <file> (default:
<project>/.sbox-editor.lock, or SBOX_EDITOR_LOCK), --stale-ms <ms> (default 900000).
Exit 0 when taken, released, refreshed or status printed; 1 when busy or not yours.`

export async function main(args) {
  if (!args.length || args.includes("--help") || args.includes("-h")) { console.log(HELP); return 0 }
  const [command, ...rest] = args
  const positional = []
  const options = { wait: true }
  let projectRoot = process.cwd(), lock
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === "--no-wait") options.wait = false
    else if (["--timeout-ms", "--stale-ms", "--project-root", "--lock"].includes(arg)) {
      const value = rest[++i]
      if (value === undefined) throw new Error(`Missing value for ${arg}`)
      if (arg === "--project-root") projectRoot = path.resolve(value)
      else if (arg === "--lock") lock = value
      else {
        if (!/^\d+$/.test(value)) throw new Error(`${arg} must be a non-negative integer`)
        options[arg === "--timeout-ms" ? "timeoutMs" : "staleMs"] = Number(value)
      }
    } else if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`)
    else positional.push(arg)
  }
  options.file = lockPath(projectRoot, lock)
  if (command === "status") { console.log(JSON.stringify(status(options))); return 0 }
  const holder = positional[0]
  if (!holder || positional.length > 1) throw new Error(`${command} takes exactly one holder name`)
  let ok
  if (command === "take") ok = await take(holder, { ...options, log: (line) => console.error(line) })
  else if (command === "release") ok = release(holder, options)
  else if (command === "refresh") ok = refresh(holder, options)
  else throw new Error(`Unknown command: ${command}`)
  console.log(JSON.stringify({ command, holder, ok, lock: status(options) }))
  return ok ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code }, (error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
