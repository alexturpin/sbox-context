#!/usr/bin/env node

import fs from "node:fs/promises"
import path from "node:path"

import { fetchText, assertOfficialApiUrl } from "./common.js"

const SCHEMA_URL = new URL("https://sbox.game/api/schema")

const SECTION_DEFINITIONS = [
  {
    id: "globals",
    title: "Globals",
    description: "Types in the global namespace.",
    matches: (type, context) => type.Namespace === "" && !context.isEditorClass(type),
  },
  {
    id: "scene-system",
    title: "Scene System",
    description: "Core scene, object, transform, prefab, map, and lifecycle APIs.",
    matches: (type, context) =>
      context.isSandboxRuntime(type) &&
      context.nameMatches(type, /(scene|gameobject|transform|prefab|map|world|startup|system)/i),
  },
  {
    id: "utility",
    title: "Utility",
    description: "General utility, helper, math, resource, and platform APIs.",
    matches: (type, context) =>
      !context.isEditorClass(type) &&
      (type.Namespace.startsWith("Sandbox.Utility") ||
        type.Namespace.startsWith("Sandbox.Resources") ||
        type.Namespace.startsWith("Sandbox.Localization") ||
        type.Namespace.startsWith("Sandbox.Mounting") ||
        type.Namespace.startsWith("Sandbox.Tasks") ||
        context.nameMatches(
          type,
          /(utility|easing|noise|random|resource|time|tag|alias|clipboard)/i,
        )),
  },
  {
    id: "diagnostics",
    title: "Diagnostics",
    description: "Assertions, logging, timing, debug, and allocation diagnostics.",
    matches: (type, context) =>
      type.Namespace.startsWith("Sandbox.Diagnostics") ||
      type.Namespace.startsWith("Sandbox.Debug") ||
      context.nameMatches(type, /(diagnostic|assert|logger|log|timer|debug|allocation)/i),
  },
  {
    id: "input",
    title: "Input",
    description: "Keyboard, pointer, controller, VR input, and input glyph APIs.",
    matches: (type, context) =>
      type.Namespace.startsWith("Sandbox.Input") ||
      type.Namespace.startsWith("Sandbox.VR") ||
      context.nameMatches(type, /(input|keyboard|mouse|pointer|controller|glyph|vr)/i),
  },
  {
    id: "audio",
    title: "Audio",
    description: "Sound, music, voice, DSP, and audio surface APIs.",
    matches: (type, context) =>
      type.Namespace.startsWith("Sandbox.Audio") ||
      context.nameMatches(type, /(audio|sound|voice|music|dsp|lip.?sync)/i),
  },
  {
    id: "graphics",
    title: "Graphics",
    description: "Rendering, materials, models, shaders, colors, cameras, decals, and particles.",
    matches: (type, context) =>
      type.Namespace.startsWith("Sandbox.Rendering") ||
      type.Namespace.startsWith("Sandbox.ModelEditor") ||
      type.Namespace.startsWith("Sandbox.MovieMaker") ||
      type.Namespace.startsWith("Sandbox.Clutter") ||
      context.nameMatches(
        type,
        /(graphics|render|shader|texture|material|model|mesh|color|camera|light|decal|particle|screen|gizmo|movie|clutter)/i,
      ),
  },
  {
    id: "network",
    title: "Network",
    description: "Networking, RPC, connection, visibility, ownership, and transport APIs.",
    matches: (type, context) =>
      type.Namespace.startsWith("Sandbox.Network") ||
      context.nameMatches(
        type,
        /(network|rpc|connection|socket|host|client|owner|visibility|snapshot)/i,
      ),
  },
  {
    id: "common-structs",
    title: "Common Structs",
    description: "Frequently used value types in the global and Sandbox namespaces.",
    matches: (type, context) =>
      !context.isEditorClass(type) &&
      type.Group === "struct" &&
      (type.Namespace === "" || type.Namespace === "Sandbox"),
  },
  {
    id: "components",
    title: "Components",
    description: "Component types and component-adjacent scene APIs.",
    matches: (type, context) =>
      context.isComponentType(type) ||
      context.nameMatches(type, /(component|temporaryeffect|effectvolume|controller)$/i),
  },
  {
    id: "live-services",
    title: "Live Services",
    description: "Achievements, leaderboards, stats, auth, player services, and platform APIs.",
    matches: (type, context) =>
      type.Namespace.startsWith("Sandbox.Services") ||
      type.Namespace.startsWith("Sandbox.Platform") ||
      context.nameMatches(type, /(achievement|leaderboard|stats|auth|service|player)/i),
  },
]

const EVERYTHING_DEFINITIONS = [
  {
    id: "attributes",
    title: "Attributes",
    description: "Attribute classes.",
    matches: (type) => type.IsAttribute,
  },
  {
    id: "classes",
    title: "Classes",
    description: "Runtime classes excluding attributes and editor-only classes.",
    matches: (type, context) =>
      type.IsClass &&
      !type.IsEnum &&
      !type.IsValueType &&
      !type.IsAttribute &&
      !type.IsInterface &&
      !context.isEditorClass(type),
  },
  {
    id: "structs",
    title: "Structs",
    description: "Value types excluding enums.",
    matches: (type) => type.IsValueType && !type.IsEnum,
  },
  {
    id: "enums",
    title: "Enums",
    description: "Enum types.",
    matches: (type) => type.IsEnum,
  },
  {
    id: "interfaces",
    title: "Interfaces",
    description: "Interface types.",
    matches: (type) => type.IsInterface,
  },
  {
    id: "editor-classes",
    title: "Editor Classes",
    description: "Editor and tool API classes.",
    matches: (type, context) => context.isEditorClass(type),
  },
]

function slugify(value) {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

function normalizeSummary(value) {
  if (!value) {
    return ""
  }

  return String(value)
    .replace(/<see\s+cref="[^"]+"\s*\/>/g, (match) => {
      const cref = match.match(/cref="([^"]+)"/)?.[1] ?? ""
      return docIdDisplayName(cref)
    })
    .replace(/<paramref\s+name="([^"]+)"\s*\/>/g, "`$1`")
    .replace(/<typeparamref\s+name="([^"]+)"\s*\/>/g, "`$1`")
    .replace(/<c>(.*?)<\/c>/gs, "`$1`")
    .replace(/<code>(.*?)<\/code>/gs, (_, code) => `\n\n\`\`\`\n${code.trim()}\n\`\`\`\n\n`)
    .replace(/<[^>]+>/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function docIdDisplayName(docId) {
  return docId
    .replace(/^[A-Z]:/, "")
    .replace(/#ctor/g, "ctor")
    .replace(/\(.*\)$/, "")
    .replace(/`\d+/g, "")
}

function markdownEscape(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]")
}

function codeCell(value) {
  if (!value) {
    return ""
  }

  return `\`${String(value).replace(/`/g, "\\`")}\``
}

function sortTypes(types) {
  return [...types].sort((a, b) => a.FullName.localeCompare(b.FullName))
}

function getTypeKind(type) {
  if (type.IsEnum) {
    return "enum"
  }

  if (type.IsInterface) {
    return "interface"
  }

  if (type.IsAttribute) {
    return "attribute"
  }

  if (type.Group === "struct" || (type.IsValueType && !type.IsEnum)) {
    return "struct"
  }

  return "class"
}


function buildTypePaths(types) {
  const used = new Set()
  const paths = new Map()
  for (const type of sortTypes(types)) {
    let base = (slugify(type.FullName) || "type").slice(0, 180)
    if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(base)) base = `type-${base}`
    let slug = base, count = 1
    while (used.has(slug.toLowerCase())) slug = `${base}-${++count}`
    used.add(slug.toLowerCase())
    paths.set(type, `types/${slug}.md`)
  }
  return paths
}

function buildContext(types) {
  const byFullName = new Map(types.map((type) => [type.FullName, type]))

  const context = {
    byFullName,
    isSandboxRuntime(type) {
      return type.Assembly === "Sandbox.Engine" || type.Assembly === "Sandbox.System"
    },
    isEditorClass(type) {
      return (
        type.Assembly === "Sandbox.Tools" ||
        type.Namespace === "Editor" ||
        type.Namespace.startsWith("Editor.") ||
        type.FullName.startsWith("Editor.")
      )
    },
    nameMatches(type, pattern) {
      return pattern.test(`${type.FullName} ${type.Name} ${type.Namespace}`)
    },
    isComponentType(type) {
      if (type.FullName === "Sandbox.Component" || type.BaseType === "Sandbox.Component") {
        return true
      }

      if (type.Name.endsWith("Component")) {
        return true
      }

      const visited = new Set()
      let current = type

      while (current?.BaseType && !visited.has(current.BaseType)) {
        visited.add(current.BaseType)

        if (current.BaseType === "Sandbox.Component" || current.BaseType.endsWith(".Component")) {
          return true
        }

        current = byFullName.get(current.BaseType)
      }

      return false
    },
  }

  return context
}

function relativeTypeLink(fromFile, type, typePaths) {
  const targetPath = typePaths.get(type)
  const relativePath = path.posix.relative(path.posix.dirname(fromFile), targetPath)
  return `[${markdownEscape(type.FullName)}](${relativePath})`
}

function pushOptionalLabel(lines, label, value) {
  const normalized = normalizeSummary(value)
  if (normalized) {
    lines.push(`- ${label}: ${normalized}`)
  }
}

function typeListMarkdown(types, fromFile, typePaths) {
  if (types.length === 0) {
    return "_No matching API types found._\n"
  }

  const lines = []

  for (const type of sortTypes(types)) {
    lines.push(`### ${relativeTypeLink(fromFile, type, typePaths)}`)
    lines.push("")
    lines.push(`- Kind: ${getTypeKind(type)}`)
    lines.push(`- Namespace: ${codeCell(type.Namespace || "(global)")}`)
    pushOptionalLabel(lines, "Summary", type.Documentation?.Summary)
    lines.push("")
  }

  return `${lines.join("\n")}\n`
}

function memberSignature(member, ownerType, kind) {
  const params = (member.Parameters ?? [])
    .map((param) => {
      const modifiers = [param.In ? "in" : "", param.Out ? "out" : "", param.Ref ? "ref" : ""]
        .filter(Boolean)
        .join(" ")
      const prefix = modifiers ? `${modifiers} ` : ""
      const suffix = param.Default !== undefined ? ` = ${param.Default}` : ""
      return `${prefix}${param.Type} ${param.Name}${suffix}`
    })
    .join(", ")

  if (kind === "constructor") {
    return `${ownerType.Name}(${params})`
  }

  if (kind === "method") {
    const staticPrefix = member.IsStatic ? "static " : ""
    return `${staticPrefix}${member.ReturnType} ${member.Name}(${params})`
  }

  if (kind === "property") {
    const staticPrefix = member.IsStatic ? "static " : ""
    return `${staticPrefix}${member.PropertyType} ${member.Name}`
  }

  const staticPrefix = member.IsStatic ? "static " : ""
  return `${staticPrefix}${member.FieldType} ${member.Name}`
}

function memberListMarkdown(title, members, ownerType, kind) {
  if (!members?.length) {
    return ""
  }

  const lines = [`## ${title}`, ""]

  for (const member of members) {
    lines.push(`### ${member.Name}`)
    lines.push("")
    lines.push(`- Signature: ${codeCell(memberSignature(member, ownerType, kind))}`)
    pushOptionalLabel(lines, "Summary", member.Documentation?.Summary)
    pushOptionalLabel(lines, "Returns", member.Documentation?.Return)

    if (member.Parameters?.length) {
      lines.push("- Parameters:")
      for (const parameter of member.Parameters) {
        const summary = normalizeSummary(member.Documentation?.Params?.[parameter.Name])
        const defaultValue = parameter.Default !== undefined ? ` = ${parameter.Default}` : ""
        const details = summary ? ` - ${summary}` : ""
        lines.push(
          `  - ${parameter.Name}: ${codeCell(`${parameter.Type}${defaultValue}`)}${details}`,
        )
      }
    }

    lines.push("")
  }

  return `${lines.join("\n")}\n\n`
}

function typePageMarkdown(type) {
  const lines = [
    `# ${type.FullName}`,
    "",
    `_${getTypeKind(type)}_`,
    "",
    `- Namespace: ${codeCell(type.Namespace || "(global)")}`,
    `- Assembly: ${codeCell(type.Assembly)}`,
    `- Doc ID: ${codeCell(type.DocId)}`,
  ]

  if (type.BaseType) {
    lines.push(`- Base type: ${codeCell(type.BaseType)}`)
  }

  if (type.DeclaringType) {
    lines.push(`- Declaring type: ${codeCell(type.DeclaringType)}`)
  }

  const summary = normalizeSummary(type.Documentation?.Summary)
  if (summary) {
    lines.push("", summary)
  }

  lines.push("")

  const memberSections = [
    memberListMarkdown("Constructors", type.Constructors, type, "constructor"),
    memberListMarkdown("Properties", type.Properties, type, "property"),
    memberListMarkdown("Methods", type.Methods, type, "method"),
    memberListMarkdown(type.IsEnum ? "Values" : "Fields", type.Fields, type, "field"),
  ]

  lines.push(...memberSections.filter(Boolean))

  return `${lines.join("\n").trimEnd()}\n`
}

function sectionPageMarkdown(section, types, typePaths) {
  return [
    `# ${section.title}`,
    "",
    section.description,
    "",
    `${types.length} API type${types.length === 1 ? "" : "s"}.`,
    "",
    typeListMarkdown(types, `${section.id}.md`, typePaths),
  ].join("\n")
}

function everythingPageMarkdown(section, types, typePaths) {
  return [
    `# ${section.title}`,
    "",
    section.description,
    "",
    `${types.length} API type${types.length === 1 ? "" : "s"}.`,
    "",
    typeListMarkdown(types, `${section.id}.md`, typePaths),
  ].join("\n")
}

function indexMarkdown(types, typePaths, context, jsonUrl) {
  const sectionEntries = SECTION_DEFINITIONS.flatMap((section) => {
    const matches = types.filter((type) => section.matches(type, context))
    return [
      `### [${section.title}](${section.id}.md)`,
      "",
      `- Types: ${matches.length}`,
      `- Description: ${section.description}`,
      "",
    ]
  })

  const everythingEntries = EVERYTHING_DEFINITIONS.flatMap((section) => {
    const matches = types.filter((type) => section.matches(type, context))
    return [
      `### [${section.title}](${section.id}.md)`,
      "",
      `- Types: ${matches.length}`,
      `- Description: ${section.description}`,
      "",
    ]
  })

  return [
    "# s&box API Reference",
    "",
    `Generated from [${jsonUrl.href}](${jsonUrl.href}).`,
    "",
    `${types.length} public API types.`,
    "",
    "## Groups",
    "",
    ...sectionEntries,
    "",
    "## Everything",
    "",
    ...everythingEntries,
    "",
    "## All Types",
    "",
    typeListMarkdown(types, "index.md", typePaths),
  ].join("\n")
}

async function writeApiDocs(schema, jsonUrl, outputDir) {
  const types = sortTypes(schema.Types ?? [])
  const typePaths = buildTypePaths(types)
  const context = buildContext(types)

  await fs.mkdir(outputDir, { recursive: true })

  await fs.writeFile(
    path.join(outputDir, "index.md"),
    indexMarkdown(types, typePaths, context, jsonUrl),
  )

  for (const section of SECTION_DEFINITIONS) {
    const typesForSection = types.filter((type) => section.matches(type, context))
    const outputPath = path.join(outputDir, `${section.id}.md`)
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await fs.writeFile(outputPath, sectionPageMarkdown(section, typesForSection, typePaths))
  }

  for (const section of EVERYTHING_DEFINITIONS) {
    const typesForSection = types.filter((type) => section.matches(type, context))
    const outputPath = path.join(outputDir, `${section.id}.md`)
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await fs.writeFile(outputPath, everythingPageMarkdown(section, typesForSection, typePaths))
  }

  for (const type of types) {
    const outputPath = path.join(outputDir, typePaths.get(type))
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await fs.writeFile(outputPath, typePageMarkdown(type))
  }

  return types.length
}


export function findJsonUrl(html) {
  // The official schema page supplies a JSON download anchor. Parse only that
  // narrow contract; reject changed markup instead of guessing a release URL.
  for (const anchor of html.matchAll(/<a\b[^>]*>/gi)) {
    const match = anchor[0].match(/\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
    if (!match) continue
    const href = (match[1] ?? match[2] ?? match[3]).replace(/&amp;/g, "&")
    const url = new URL(href, SCHEMA_URL)
    if (!url.pathname.endsWith(".json")) continue
    assertOfficialApiUrl(url)
    return url
  }
  throw new Error("No JSON download anchor found on the official API schema page")
}

export async function fetchApi(outputDir, options = {}) {
  const request = options.requestText ?? ((url) => fetchText(url, options))
  let jsonUrl
  if (options.apiUrl && options.apiUrl !== "latest") {
    jsonUrl = new URL(options.apiUrl)
    assertOfficialApiUrl(jsonUrl)
  } else {
    console.log(`Fetching ${SCHEMA_URL.href}`)
    jsonUrl = findJsonUrl(await request(SCHEMA_URL))
  }
  console.log(`Fetching ${jsonUrl.href}`)
  const schema = JSON.parse(await request(jsonUrl))
  if (!Array.isArray(schema.Types) || !schema.Types.length || schema.Types.some((type) =>
    !type || typeof type.FullName !== "string" || !type.FullName ||
    typeof type.Name !== "string" || typeof type.Namespace !== "string" ||
    typeof type.Assembly !== "string")) {
    throw new Error("API schema must contain nonempty Types with FullName, Name, Namespace, and Assembly")
  }
  const count = await writeApiDocs(schema, jsonUrl, outputDir)
  await fs.writeFile(path.join(outputDir, "schema.json"), `${JSON.stringify(schema)}\n`)
  return { url: jsonUrl.href, schemaPage: SCHEMA_URL.href, types: count, selection: jsonUrl.href }
}
