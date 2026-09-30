#!/usr/bin/env node
import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { DEFAULT_PATHS, exists, fingerprint, readManifest, resolvePaths, assertNoLinks, synchronizeResource, assertOfficialApiUrl } from "./common.js"
import { fetchDocs } from "./fetch-sbox-docs.js"
import { fetchApi } from "./fetch-sbox-api.js"
import { fetchSource } from "./fetch-sbox-public.js"

export const HELP = `Usage:
  node sbox-context.js sync --project-root <existing-directory> [options]
  node sbox-context.js status --project-root <existing-directory> [path-options]

  --resources docs,api,source | all   Default: docs,api
  --docs-dir <relative-path>         Default: docs/sbox-docs
  --api-dir <relative-path>          Default: docs/sbox-api
  --source-dir <relative-path>       Default: reference/sbox-public
  --source-ref <commit/tag/branch>   Reuse recorded commit, or initially HEAD
  --api-url <official-json-url>      Reuse recorded URL, or initially latest
                                    Use 'latest' to advance the API pin
  --adopt                           Replace inspected, unmanaged snapshots
  --delay-ms <integer>               Docs request delay (default: 500)
  --jitter-ms <integer>              Extra docs delay (default: 1000)
  --timeout-ms <integer>             Per-request timeout (default: 30000)
  --help                            Show this help

Recorded paths are reused unless overridden. Source/API selections stay pinned
after setup; use --source-ref HEAD or --api-url latest to explicitly advance.
Paths must be disjoint and inside the project. Local edits are never overwritten.
Each resource commits separately. Failed downloads retain the existing resource.
Node.js 22+; Git needed only for source. No npm install required.`

export function parseArgs(args) {
  if (args.includes("--help") || args.includes("-h")) return { help: true }
  const [command, ...rest] = args
  if (!["sync", "status"].includes(command)) throw new Error("Expected sync or status; use --help")
  const options = { command, paths: {} }
  const keys = {
    "--project-root": "projectRoot", "--resources": "resources", "--source-ref": "sourceRef",
    "--api-url": "apiUrl", "--delay-ms": "delayMs", "--jitter-ms": "jitterMs", "--timeout-ms": "timeoutMs",
  }
  const seen = new Set()
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]
    if (seen.has(flag)) throw new Error(`Duplicate option: ${flag}`)
    seen.add(flag)
    if (flag === "--adopt") { options.adopt = true; continue }
    const resource = Object.keys(DEFAULT_PATHS).find((name) => flag === `--${name}-dir`)
    const key = keys[flag]
    if (!resource && !key) throw new Error(`Unknown option: ${flag}`)
    const value = rest[++i]
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${flag}`)
    if (resource) options.paths[resource] = value
    else if (["delayMs", "jitterMs", "timeoutMs"].includes(key)) {
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 60000 || (key === "timeoutMs" && Number(value) < 1)) {
        throw new Error(`${flag} must be an integer between ${key === "timeoutMs" ? 1 : 0} and 60000`)
      }
      options[key] = Number(value)
    } else options[key] = value
  }
  if (!options.projectRoot) throw new Error("--project-root is required")
  if (command === "status" && [...seen].some((flag) => flag !== "--project-root" && !flag.endsWith("-dir"))) {
    throw new Error("status accepts only --project-root and path options")
  }
  const resources = options.resources ?? "docs,api"
  options.resources = resources === "all" ? Object.keys(DEFAULT_PATHS) : resources.split(",")
  if (!options.resources.length || options.resources.some((name) => !Object.hasOwn(DEFAULT_PATHS, name)) || new Set(options.resources).size !== options.resources.length) {
    throw new Error("--resources must select docs, api, source, or all without duplicates")
  }
  if (options.apiUrl && options.apiUrl !== "latest") assertOfficialApiUrl(options.apiUrl)
  if (options.apiUrl && !options.resources.includes("api")) throw new Error("--api-url requires api in --resources")
  if (options.sourceRef && !options.resources.includes("source")) throw new Error("--source-ref requires source in --resources")
  return options
}

export async function main(args, builders = { docs: fetchDocs, api: fetchApi, source: fetchSource }) {
  const options = parseArgs(args)
  if (options.help) { console.log(HELP); return }
  const root = await fs.realpath(path.resolve(options.projectRoot))
  if (!(await fs.stat(root)).isDirectory()) throw new Error("Project root must be an existing directory")
  const manifest = await readManifest(root)
  const paths = resolvePaths(root, options.paths, manifest)
  // Validate every configured destination before any network work or writes.
  for (const destination of Object.values(paths)) await assertNoLinks(root, destination)
  if (options.command === "status") {
    const resources = {}
    for (const [name, destination] of Object.entries(paths)) {
      const record = manifest.resources[name]
      let state = "missing"
      if (await exists(destination)) {
        if (!(await fs.lstat(destination)).isDirectory()) throw new Error(`Reference path is not a directory: ${destination}`)
        state = record?.path === path.relative(root, destination).split(path.sep).join("/") ?
          ((await fingerprint(destination)).contentSha256 === record.contentSha256 ? "managed" : "modified") : "unmanaged"
      }
      resources[name] = { ...record, resolvedPath: destination, state }
    }
    console.log(JSON.stringify({ projectRoot: root, resources }, null, 2))
    return
  }
  for (const name of options.resources) {
    const recorded = manifest.resources[name]
    const selection = {
      ...options,
      apiUrl: options.apiUrl ?? (name === "api" ? recorded?.selection : undefined),
      sourceRef: options.sourceRef ?? (name === "source" ? recorded?.selection : undefined),
    }
    await synchronizeResource(root, name, paths[name], (stage) => builders[name](stage, selection), options)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1 })
}
