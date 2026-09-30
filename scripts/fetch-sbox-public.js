import fs from "node:fs/promises"
import path from "node:path"
import { run, removeWithin } from "./common.js"

export const REPOSITORY_URL = "https://github.com/Facepunch/sbox-public.git"

export async function fetchSource(outputDir, options = {}) {
  const ref = options.sourceRef ?? "HEAD"
  if (!ref || ref.startsWith("-") || /[\s\x00-\x1f]/.test(ref)) throw new Error("Invalid source ref")
  // Repository override is for isolated local-Git tests, not a CLI option.
  const repository = options.repositoryUrl ?? REPOSITORY_URL
  console.log(`Fetching ${repository} at ${ref}`)
  await run("git", ["init", "--quiet", outputDir])
  await run("git", ["-C", outputDir, "remote", "add", "origin", repository])
  await run("git", ["-C", outputDir, "fetch", "--depth", "1", "--no-tags", "origin", ref])
  await run("git", ["-C", outputDir, "-c", "core.autocrlf=false", "checkout", "--quiet", "--detach", "FETCH_HEAD"])
  const revision = await run("git", ["-C", outputDir, "rev-parse", "HEAD"])
  if (!/^[a-f0-9]{40,64}$/.test(revision)) throw new Error("Unexpected source revision")
  await removeWithin(outputDir, path.join(outputDir, ".git"))
  return { url: repository, revision, requestedRef: ref, selection: revision }
}
