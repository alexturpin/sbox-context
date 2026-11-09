import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { spawnSync } from "node:child_process"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { isEntryPoint } from "../entry.js"

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

test("isEntryPoint matches the started script and rejects others", () => {
  const self = path.join(SCRIPTS, "editor-lock.js")
  assert.equal(isEntryPoint(pathToFileURL(self).href, self), true)
  assert.equal(isEntryPoint(pathToFileURL(self).href, path.join(SCRIPTS, "editor.js")), false)
  assert.equal(isEntryPoint(pathToFileURL(self).href, undefined), false)
})

test("scripts still run when started through a symlinked folder", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sbox-context-entry-"))
  const link = path.join(dir, "linked-scripts")
  try {
    try {
      symlinkSync(SCRIPTS, link, process.platform === "win32" ? "junction" : "dir")
    } catch (error) {
      t.skip(`cannot create a directory link here: ${error.code}`)
      return
    }
    const project = mkdtempSync(path.join(os.tmpdir(), "sbox-context-entry-project-"))
    try {
      const result = spawnSync(process.execPath, [path.join(link, "editor-lock.js"), "status", "--project-root", project], { encoding: "utf8" })
      assert.equal(result.status, 0, result.stderr)
      const out = JSON.parse(result.stdout)
      assert.equal(out.held, false)
    } finally {
      rmSync(project, { recursive: true, force: true })
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
