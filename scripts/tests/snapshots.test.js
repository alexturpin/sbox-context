import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { fingerprint, exists, readManifest, resolvePaths, synchronizeResource, removeWithin, run, MANIFEST, UPDATE_LOCK } from "../common.js"
import { fetchDocs, relativeHref } from "../fetch-sbox-docs.js"
import { fetchApi, findJsonUrl } from "../fetch-sbox-api.js"
import { fetchSource } from "../fetch-sbox-public.js"
import { parseArgs, main } from "../sbox-context.js"

async function project(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sbox-context-test-"))
  t.after(() => removeWithin(os.tmpdir(), root))
  return root
}

async function buildText(stage, text = "reference\n") {
  await fs.writeFile(path.join(stage, "index.md"), text)
  return { url: "https://sbox.game/llms.txt", selection: "website" }
}

function docsRequest(pages) {
  const requested = []
  return {
    requested,
    options: {
      delayMs: 0, jitterMs: 0,
      requestText: async (url) => {
        requested.push(url.href)
        if (!Object.hasOwn(pages, url.pathname)) throw new Error(`Missing fixture: ${url.pathname}`)
        return pages[url.pathname]
      },
    },
  }
}

test("docs follow section links, deduplicate index aliases, preserve code, and keep API/assets online", async (t) => {
  const root = await project(t)
  const destination = resolvePaths(root).docs
  const fixture = docsRequest({
    "/llms.txt": "# Docs\n[Scene](/dev/doc/scene/)\n[Same scene](/dev/doc/scene/index.md)\n## API Reference\n- [API](/api/Sandbox.Scene)\n",
    "/dev/doc/scene.md": '# Scene\n[Child](./components.md#start)\n[API](/api/Sandbox.Scene)\n![Image](./picture.png)\n```csharp\n[Keep](/dev/doc/scene/)\n```\n',
    "/dev/doc/scene/components.md": "# Components\n[Parent](/dev/doc/scene/)\n",
  })
  const record = await synchronizeResource(root, "docs", destination, (stage) => fetchDocs(stage, fixture.options))
  assert.equal(record.pages, 2)
  assert.equal(fixture.requested.length, 3)
  assert.match(await fs.readFile(path.join(destination, "scene.md"), "utf8"), /\[Child\]\(scene\/components\.md#start\)/)
  const scene = await fs.readFile(path.join(destination, "scene.md"), "utf8")
  assert.match(scene, /https:\/\/sbox\.game\/api\/Sandbox.Scene/)
  assert.match(scene, /https:\/\/sbox\.game\/dev\/doc\/scene\/picture.png/)
  assert.match(scene, /\[Keep\]\(\/dev\/doc\/scene\/\)/)
  assert.doesNotMatch(await fs.readFile(path.join(destination, "index.md"), "utf8"), /## API Reference/)
  assert.equal((await readManifest(root)).resources.docs.contentSha256, (await fingerprint(destination)).contentSha256)
})

test("failed docs acquisition leaves a managed snapshot and manifest untouched", async (t) => {
  const root = await project(t)
  const destination = resolvePaths(root).docs
  await synchronizeResource(root, "docs", destination, (stage) => buildText(stage, "old\n"))
  const before = await fs.readFile(path.join(root, MANIFEST), "utf8")
  const fixture = docsRequest({ "/llms.txt": "[Missing](/dev/doc/missing/)\n" })
  await assert.rejects(synchronizeResource(root, "docs", destination, (stage) => fetchDocs(stage, fixture.options)), /Missing fixture/)
  assert.equal(await fs.readFile(path.join(destination, "index.md"), "utf8"), "old\n")
  assert.equal(await fs.readFile(path.join(root, MANIFEST), "utf8"), before)
  assert.deepEqual((await fs.readdir(root)).filter((entry) => entry.startsWith(".sbox-context")), [])
})

test("empty indexes and HTML error pages cannot replace docs", async (t) => {
  const root = await project(t)
  for (const content of ["", "<!doctype html><html>Server error</html>", "# No links"]) {
    const fixture = docsRequest({ "/llms.txt": content })
    await assert.rejects(synchronizeResource(root, "docs", resolvePaths(root).docs, (stage) => fetchDocs(stage, fixture.options)), /Expected Markdown|No documentation links/)
  }
  assert.equal(await exists(path.join(root, MANIFEST)), false)
})

test("encoded traversal in doc destinations is rejected before publication", async (t) => {
  const root = await project(t)
  const fixture = docsRequest({
    "/llms.txt": "[Escape](/dev/doc/%2e%2e%2f%2e%2e%2fescape.md)",
    "/dev/doc/%2e%2e%2f%2e%2e%2fescape.md": "# Escape",
  })
  await assert.rejects(synchronizeResource(root, "docs", resolvePaths(root).docs, (stage) => fetchDocs(stage, fixture.options)), /outside|strictly inside/)
  assert.equal(await exists(path.join(root, "escape.md")), false)
})

function apiType(fullName, extras = {}) {
  return { FullName: fullName, Name: fullName.split(".").at(-1), Namespace: "Sandbox", Assembly: "Sandbox.Engine", IsClass: true, ...extras }
}

test("API discovery renders signatures and produces distinct Windows-safe type paths", async (t) => {
  const root = await project(t)
  const schemaUrl = "https://cdn.sbox.game/releases/fixture.json"
  const schema = { Types: [
    apiType("Sandbox.Sample", { Documentation: { Summary: 'Use <c>Sample</c>.' }, Methods: [{ Name: "Set", ReturnType: "void", Parameters: [{ Name: "value", Type: "int", Default: 2 }], Documentation: { Params: { value: "New value" } } }] }),
    apiType("Sandbox.Case"), apiType("Sandbox.case"), apiType("Sandbox.A:B"), apiType("Sandbox.A?B"), apiType("Sandbox.A-B-2"), apiType("CON"),
  ] }
  const requested = []
  const record = await synchronizeResource(root, "api", resolvePaths(root).api, (stage) => fetchApi(stage, {
    requestText: async (url) => {
      requested.push(url.href)
      return url.href.endsWith("/schema") ? `<a data-href="https://bad.example/fake.json">Ignore</a><a href='${schemaUrl}'>Download</a>` : JSON.stringify(schema)
    },
  }))
  assert.equal(record.selection, schemaUrl)
  assert.equal(requested.length, 2)
  const files = await fs.readdir(path.join(root, "docs/sbox-api/types"))
  assert.equal(files.length, schema.Types.length)
  assert.equal(new Set(files.map((file) => file.toLowerCase())).size, files.length)
  assert.ok(files.includes("type-CON.md"))
  const sample = await fs.readFile(path.join(root, "docs/sbox-api/types/Sandbox.Sample.md"), "utf8")
  assert.match(sample, /void Set\(int value = 2\)/)
  assert.match(sample, /Use `Sample`\./)
  assert.match(sample, /New value/)
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, "docs/sbox-api/schema.json"), "utf8")), schema)
})

test("API pins bypass discovery, and malformed or empty schemas preserve the old snapshot", async (t) => {
  const root = await project(t)
  const destination = resolvePaths(root).api
  const apiUrl = "https://cdn.sbox.game/releases/pinned.json"
  await synchronizeResource(root, "api", destination, (stage) => fetchApi(stage, { apiUrl, requestText: async (url) => {
    assert.equal(url.href, apiUrl)
    return JSON.stringify({ Types: [apiType("Sandbox.Pinned")] })
  } }))
  const before = await fingerprint(destination)
  for (const schema of [{ Types: [] }, { Types: [{ Name: "Broken" }] }, { Unexpected: true }]) {
    await assert.rejects(synchronizeResource(root, "api", destination, (stage) => fetchApi(stage, { apiUrl, requestText: async () => JSON.stringify(schema) })), /API schema/)
    assert.deepEqual(await fingerprint(destination), before)
  }
  assert.throws(() => findJsonUrl('<a href="https://example.com/reference.json">Download</a>'), /API URL/)
})

test("refresh updates owned snapshots but refuses local edits even with adopt", async (t) => {
  const root = await project(t)
  const destination = resolvePaths(root).docs
  await synchronizeResource(root, "docs", destination, (stage) => buildText(stage, "first"))
  await synchronizeResource(root, "docs", destination, (stage) => buildText(stage, "second"))
  await fs.writeFile(path.join(destination, "notes.md"), "custom work")
  let called = false
  await assert.rejects(synchronizeResource(root, "docs", destination, async (stage) => { called = true; return buildText(stage) }, { adopt: true }), /Local edits/)
  assert.equal(called, false)
  assert.equal(await fs.readFile(path.join(destination, "notes.md"), "utf8"), "custom work")
})

test("unmanaged snapshots require explicit adoption and retain unrelated references", async (t) => {
  const root = await project(t)
  const destination = resolvePaths(root).docs
  await fs.mkdir(destination, { recursive: true })
  await fs.writeFile(path.join(destination, "old.md"), "legacy")
  await fs.mkdir(path.join(root, "reference/OtherGame"), { recursive: true })
  await fs.writeFile(path.join(root, "reference/OtherGame/keep.txt"), "keep")
  await assert.rejects(synchronizeResource(root, "docs", destination, buildText), /Unmanaged/)
  await synchronizeResource(root, "docs", destination, buildText, { adopt: true })
  assert.equal(await exists(path.join(destination, "old.md")), false)
  assert.equal(await fs.readFile(path.join(root, "reference/OtherGame/keep.txt"), "utf8"), "keep")
})

test("manifest publication failure rolls back the previous directory", async (t) => {
  const root = await project(t)
  const destination = resolvePaths(root).docs
  await synchronizeResource(root, "docs", destination, (stage) => buildText(stage, "old"))
  const originalRename = fs.rename
  fs.rename = async (from, to) => {
    if (to === path.join(root, MANIFEST)) throw Object.assign(new Error("manifest locked"), { code: "EPERM" })
    return originalRename(from, to)
  }
  try { await assert.rejects(synchronizeResource(root, "docs", destination, (stage) => buildText(stage, "new")), /manifest locked/) }
  finally { fs.rename = originalRename }
  assert.equal(await fs.readFile(path.join(destination, "index.md"), "utf8"), "old")
  assert.equal((await fingerprint(destination)).contentSha256, (await readManifest(root)).resources.docs.contentSha256)
})

test("directory publication locks retain the old snapshot without destructive fallback", async (t) => {
  const root = await project(t)
  const destination = resolvePaths(root).docs
  await synchronizeResource(root, "docs", destination, (stage) => buildText(stage, "old"))
  const originalRename = fs.rename
  fs.rename = async (from, to) => {
    if (from === destination) throw Object.assign(new Error("directory locked"), { code: "EPERM" })
    return originalRename(from, to)
  }
  try { await assert.rejects(synchronizeResource(root, "docs", destination, (stage) => buildText(stage, "new")), /directory locked/) }
  finally { fs.rename = originalRename }
  assert.equal(await fs.readFile(path.join(destination, "index.md"), "utf8"), "old")
})

test("concurrent updates are refused and edits made during download are preserved", async (t) => {
  const root = await project(t)
  const destination = resolvePaths(root).docs
  await synchronizeResource(root, "docs", destination, buildText)
  await assert.rejects(synchronizeResource(root, "docs", destination, async (stage) => {
    await assert.rejects(synchronizeResource(root, "api", resolvePaths(root).api, buildText), /Another update/)
    await fs.writeFile(path.join(destination, "index.md"), "edited during download")
    return buildText(stage)
  }), /changed during download/)
  assert.equal(await fs.readFile(path.join(destination, "index.md"), "utf8"), "edited during download")
  assert.equal(await exists(path.join(root, UPDATE_LOCK)), false)
})

test("empty snapshots are rejected and resources commit independently", async (t) => {
  const root = await project(t)
  await synchronizeResource(root, "docs", resolvePaths(root).docs, buildText)
  await assert.rejects(synchronizeResource(root, "api", resolvePaths(root).api, async () => ({})), /empty api/)
  assert.deepEqual(Object.keys((await readManifest(root)).resources), ["docs"])
})

test("paths remain contained, disjoint, and outside repository metadata", async (t) => {
  const root = await project(t)
  for (const paths of [{ docs: ".." }, { api: "../escape" }, { docs: "." }, { source: "C:\\elsewhere" }, { docs: ".git/refs" }, { api: "docs/sbox-docs/child" }, { source: MANIFEST }]) {
    assert.throws(() => resolvePaths(root, paths), /relative|strictly inside|Reserved|disjoint/)
  }
  const manifest = { resources: { docs: { path: "context/docs" } } }
  assert.equal(resolvePaths(root, {}, manifest).docs, path.join(root, "context/docs"))
})

test("symlink or junction destinations cannot overwrite another directory", async (t) => {
  const root = await project(t)
  const external = await project(t)
  await fs.writeFile(path.join(external, "keep.md"), "external")
  await fs.mkdir(path.join(root, "docs"))
  await fs.symlink(external, path.join(root, "docs/sbox-docs"), process.platform === "win32" ? "junction" : "dir")
  await assert.rejects(synchronizeResource(root, "docs", resolvePaths(root).docs, buildText, { adopt: true }), /symlink|junction/)
  assert.equal(await fs.readFile(path.join(external, "keep.md"), "utf8"), "external")
})

test("CLI requires explicit roots and validates selections and numeric flags", () => {
  assert.deepEqual(parseArgs(["--help"]), { help: true })
  const root = process.cwd()
  const options = parseArgs(["sync", "--project-root", root, "--resources", "all", "--source-ref", "HEAD", "--api-url", "latest"])
  assert.deepEqual(options.resources, ["docs", "api", "source"])
  for (const args of [
    ["sync"], ["sync", "--project-root", root, "--resources", "api,api"],
    ["sync", "--project-root", root, "--delay-ms", "1junk"],
    ["sync", "--project-root", root, "--timeout-ms", "0"],
    ["sync", "--project-root", root, "--project-root", root],
    ["sync", "--project-root", root, "--source-ref", "HEAD"],
    ["status", "--project-root", root, "--adopt"],
  ]) assert.throws(() => parseArgs(args))
  assert.equal(relativeHref(new URL("https://sbox.game/dev/doc/scene.md"), "#anchor"), "#anchor")
})

test("CLI status reports missing resources without creating files", async (t) => {
  const root = await project(t)
  const cli = new URL("../sbox-context.js", import.meta.url)
  const output = spawnSync(process.execPath, [fileURLToPath(cli), "status", "--project-root", root], { encoding: "utf8", windowsHide: true })
  assert.equal(output.status, 0, output.stderr)
  const state = JSON.parse(output.stdout)
  assert.equal(state.resources.source.state, "missing")
  assert.deepEqual(await fs.readdir(root), [])
})

test("CLI reuses recorded paths and pins, and advances only on explicit selections", async (t) => {
  const root = await project(t)
  const apiUrl = "https://cdn.sbox.game/releases/locked.json"
  const revision = "a".repeat(40)
  const received = []
  const builders = Object.fromEntries(["docs", "api", "source"].map((name) => [name, async (stage, options) => {
    received.push({ name, apiUrl: options.apiUrl, sourceRef: options.sourceRef })
    await buildText(stage)
    return { selection: name === "source" ? revision : name === "api" ? apiUrl : "website" }
  }]))
  await main(["sync", "--project-root", root, "--resources", "all", "--docs-dir", "context/docs"], builders)
  assert.equal((await readManifest(root)).resources.docs.path, "context/docs")
  assert.equal(received.find((item) => item.name === "source").sourceRef, undefined)
  received.length = 0
  await main(["sync", "--project-root", root, "--resources", "all"], builders)
  assert.equal((await readManifest(root)).resources.docs.path, "context/docs")
  assert.equal(received.find((item) => item.name === "source").sourceRef, revision)
  assert.equal(received.find((item) => item.name === "api").apiUrl, apiUrl)
  received.length = 0
  await main(["sync", "--project-root", root, "--resources", "source,api", "--source-ref", "HEAD", "--api-url", "latest"], builders)
  assert.equal(received.find((item) => item.name === "source").sourceRef, "HEAD")
  assert.equal(received.find((item) => item.name === "api").apiUrl, "latest")
})

test("source snapshots support exact commits, preserve tracked dotfiles, and strip Git metadata", async (t) => {
  const root = await project(t)
  const repository = path.join(root, "upstream")
  await fs.mkdir(repository)
  await run("git", ["init", "--quiet", repository])
  await fs.writeFile(path.join(repository, "engine.cs"), "first")
  await fs.writeFile(path.join(repository, ".gitignore"), "bin/\n")
  await run("git", ["-C", repository, "add", "."])
  const commit = ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "fixture"]
  await run("git", ["-C", repository, ...commit])
  const first = await run("git", ["-C", repository, "rev-parse", "HEAD"])
  await fs.writeFile(path.join(repository, "engine.cs"), "second")
  await run("git", ["-C", repository, "add", "."])
  await run("git", ["-C", repository, ...commit])
  const destination = resolvePaths(root).source
  const record = await synchronizeResource(root, "source", destination, (stage) => fetchSource(stage, { sourceRef: first, repositoryUrl: repository }))
  assert.equal(record.revision, first)
  assert.equal(record.selection, first)
  assert.equal(await fs.readFile(path.join(destination, "engine.cs"), "utf8"), "first")
  assert.equal(await fs.readFile(path.join(destination, ".gitignore"), "utf8"), "bin/\n")
  assert.equal(await exists(path.join(destination, ".git")), false)
})
