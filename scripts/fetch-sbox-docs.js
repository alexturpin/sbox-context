#!/usr/bin/env node

import fs from "node:fs/promises"
import path from "node:path"

import { fetchText as requestText, assertWithin } from "./common.js"

const BASE_URL = new URL("https://sbox.game")
const LLMS_URL = new URL("/llms.txt", BASE_URL)
const DOC_ROOT = "/dev/doc"

function isSboxUrl(url) {
  return url.origin === BASE_URL.origin
}

function isApiUrl(url) {
  return url.pathname === "/api" || url.pathname.startsWith("/api/")
}

function resolveUrl(href, baseUrl) {
  const sectionLink = href.startsWith("./") && baseUrl.pathname.endsWith(".md")
  const resolutionBase = new URL(baseUrl.href)

  if (sectionLink) {
    resolutionBase.pathname = resolutionBase.pathname.replace(/\.md$/, "/")
  }

  return new URL(href, resolutionBase)
}

function normalizeDocIndexPath(pathname) {
  if (pathname.endsWith("/index.md")) {
    return `${pathname.slice(0, -"/index.md".length)}.md`
  }

  return pathname
}

function toFetchUrl(href, baseUrl) {
  if (!href || href.startsWith("#")) {
    return null
  }

  let url
  try {
    url = resolveUrl(href, baseUrl)
  } catch {
    return null
  }

  if (!isSboxUrl(url) || isApiUrl(url)) {
    return null
  }

  let pathname = url.pathname.replace(/\/+$/, "")
  const extension = path.posix.extname(pathname)
  const isDocPath = pathname === DOC_ROOT || pathname.startsWith(`${DOC_ROOT}/`)
  const isMarkdownPath = pathname.endsWith(".md")

  if (extension && extension !== ".md") {
    return null
  }

  if (!isDocPath && !isMarkdownPath) {
    return null
  }

  if (!isMarkdownPath) {
    pathname += ".md"
  }

  pathname = normalizeDocIndexPath(pathname)

  const fetchUrl = new URL(url.href)
  fetchUrl.pathname = pathname
  fetchUrl.search = ""
  fetchUrl.hash = ""

  return fetchUrl
}

function localPathForUrl(url, outputDir) {
  const parts = localRelativePathForUrl(url).split("/").filter(Boolean)
  const outputPath = path.resolve(outputDir, ...parts)

  if (outputPath !== outputDir && !outputPath.startsWith(`${outputDir}${path.sep}`)) {
    throw new Error(`Refusing to write outside ${outputDir}: ${url.href}`)
  }

  return outputPath
}

function localRelativePathForUrl(url) {
  const pathname = decodeURIComponent(url.pathname)

  if (pathname === `${DOC_ROOT}.md`) {
    return "index.md"
  }

  if (pathname.startsWith(`${DOC_ROOT}/`)) {
    return path.posix.normalize(pathname.slice(DOC_ROOT.length + 1))
  }

  return path.posix.normalize(pathname.replace(/^\/+/, ""))
}

function splitMarkdownDestination(rawDestination) {
  const leading = rawDestination.match(/^\s*/)[0]
  const trailing = rawDestination.match(/\s*$/)[0]
  const trimmed = rawDestination.trim()

  if (trimmed.startsWith("<")) {
    const closeIndex = trimmed.indexOf(">")
    if (closeIndex === -1) {
      return null
    }

    return {
      href: trimmed.slice(1, closeIndex),
      format: "angle",
      leading,
      rest: trimmed.slice(closeIndex + 1),
      trailing,
    }
  }

  const match = trimmed.match(/^(\S+)([\s\S]*)$/)
  if (!match) {
    return null
  }

  return {
    href: match[1],
    format: "plain",
    leading,
    rest: match[2],
    trailing,
  }
}

function joinMarkdownDestination(parsed, href) {
  if (parsed.format === "angle") {
    return `${parsed.leading}<${href}>${parsed.rest}${parsed.trailing}`
  }

  return `${parsed.leading}${href}${parsed.rest}${parsed.trailing}`
}

function extractMarkdownDestinations(markdown) {
  const destinations = []
  const patterns = [
    /!?\[[^\]\n]*(?:\][^\[\]\n]*)*]\(([^)\n]+)\)/g,
    /^\s*\[[^\]\n]+]:\s*(\S+)/gm,
    /<(https?:\/\/[^>\s]+|\/dev\/doc\/[^>\s]+)>/g,
    /(?:href|src)=["']([^"']+)["']/g,
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(markdown))) {
      destinations.push(match[1])
    }
  }

  return destinations
}

function splitFencedCodeBlocks(markdown) {
  return markdown.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g)
}

function removeApiReferenceSection(markdown) {
  return (
    markdown.replace(/\r?\n## API Reference\s*\r?\n+(?:- .*(?:\r?\n|$))*/g, "").trimEnd() + "\n"
  )
}

export function relativeHref(fromUrl, href) {
  if (href.startsWith("#")) {
    return href
  }

  const targetUrl = toFetchUrl(href, fromUrl)
  if (!targetUrl) {
    try {
      const resolved = resolveUrl(href, fromUrl)
      return ["https:", "http:"].includes(resolved.protocol) ? resolved.href : href
    } catch {
      return href
    }
  }

  let hash = ""
  try {
    hash = new URL(href, fromUrl).hash
  } catch {
    hash = ""
  }

  const fromPath = localRelativePathForUrl(toFetchUrl(fromUrl.href, BASE_URL) ?? fromUrl)
  const targetPath = localRelativePathForUrl(targetUrl)

  if (fromPath === targetPath) {
    return hash || path.posix.basename(targetPath)
  }

  const relativePath = path.posix.relative(path.posix.dirname(fromPath), targetPath)
  return `${relativePath}${hash}`
}

function rewriteMarkdownLinks(markdown, fromUrl) {
  return splitFencedCodeBlocks(markdown)
    .map((part, index) => {
      if (index % 2 === 1) {
        return part
      }

      return part
        .replace(
          /(!?\[[^\]\n]*(?:\][^\[\]\n]*)*]\()([^\)\n]+)(\))/g,
          (match, prefix, destination, suffix) => {
            const parsed = splitMarkdownDestination(destination)
            if (!parsed) {
              return match
            }

            return `${prefix}${joinMarkdownDestination(parsed, relativeHref(fromUrl, parsed.href))}${suffix}`
          },
        )
        .replace(/^(\s*\[[^\]\n]+]:\s*)(\S+)/gm, (match, prefix, href) => {
          return `${prefix}${relativeHref(fromUrl, href)}`
        })
        .replace(
          /(<)(https?:\/\/[^>\s]+|\/dev\/doc\/[^>\s]+)(>)/g,
          (match, prefix, href, suffix) => {
            return `${prefix}${relativeHref(fromUrl, href)}${suffix}`
          },
        )
        .replace(/((?:href|src)=["'])([^"']+)(["'])/g, (match, prefix, href, suffix) => {
          return `${prefix}${relativeHref(fromUrl, href)}${suffix}`
        })
    })
    .join("")
}

function enqueueDiscoveredLinks(markdown, baseUrl, queued, seen, queue) {
  for (const destination of extractMarkdownDestinations(markdown)) {
    const parsed = splitMarkdownDestination(destination)
    const href = parsed ? parsed.href : destination
    const fetchUrl = toFetchUrl(href, baseUrl)

    if (!fetchUrl) {
      continue
    }

    const key = fetchUrl.href
    if (seen.has(key) || queued.has(key)) {
      continue
    }

    queued.add(key)
    queue.push(fetchUrl)
  }
}

async function writeGeneratedFiles(llmsMarkdown, pages, outputDir) {
  await fs.mkdir(outputDir, { recursive: true })

  const indexOutput = path.join(outputDir, "index.md")
  const rewrittenIndex = rewriteMarkdownLinks(removeApiReferenceSection(llmsMarkdown), LLMS_URL)
  await fs.writeFile(indexOutput, rewrittenIndex)

  for (const [href, markdown] of pages) {
    const url = new URL(href)
    const outputPath = localPathForUrl(url, outputDir)
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await fs.writeFile(outputPath, rewriteMarkdownLinks(markdown, url))
  }
}


export async function fetchDocs(outputDir, options = {}) {
  const request = options.requestText ?? ((url) => requestText(url, options))
  const queue = []
  const queued = new Set()
  const seen = new Map()
  const delayMs = options.delayMs ?? 500
  const jitterMs = options.jitterMs ?? 1000
  let nextRequestAt = 0
  async function get(url) {
    const waitMs = Math.max(0, nextRequestAt - Date.now())
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs))
    console.log(`Fetching ${url.href}`)
    const text = await request(url)
    nextRequestAt = Date.now() + delayMs + Math.floor(Math.random() * (jitterMs + 1))
    if (!text.trim() || /^\s*(?:<!doctype\s+html|<html\b)/i.test(text)) {
      throw new Error(`Expected Markdown, received empty or HTML content: ${url.href}`)
    }
    return text
  }
  const index = await get(LLMS_URL)
  enqueueDiscoveredLinks(index, LLMS_URL, queued, seen, queue)
  if (!queue.length) throw new Error("No documentation links found in the official llms.txt")
  while (queue.length) {
    const url = queue.shift()
    queued.delete(url.href)
    if (seen.has(url.href)) continue
    const markdown = await get(url)
    seen.set(url.href, markdown)
    enqueueDiscoveredLinks(markdown, url, queued, seen, queue)
  }
  // Validate every destination before writing even the staged snapshot.
  for (const href of seen.keys()) assertWithin(outputDir, localPathForUrl(new URL(href), outputDir))
  await writeGeneratedFiles(index, seen, outputDir)
  return { url: LLMS_URL.href, pages: seen.size, selection: "website" }
}
