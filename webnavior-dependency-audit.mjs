import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { execFileSync } from 'node:child_process'
import { builtinModules } from 'node:module'

const ROOT = process.cwd()
const OUT_DIR = path.join(ROOT, 'docs/generated')
const OUT_MD = path.join(OUT_DIR, 'webnavior-dependency-audit.md')
const OUT_JSON = path.join(OUT_DIR, 'webnavior-dependency-audit.json')

const args = process.argv.slice(2)
let baseline = null
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--baseline')
    baseline = args[i + 1] ?? null
  else if (args[i].startsWith('--baseline='))
    baseline = args[i].slice('--baseline='.length)
}

const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue'])
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.output',
  '.nuxt',
  '.turbo',
  '.vite',
  '.cache',
  'generated',
  'vendor',
  'target',
  'bin',
  'obj',
])

// Based on the current feature inventory.
// Missing paths are skipped automatically.
const EXPLICIT_SCOPE = [
  'apps/stage-kiosk',
  'apps/order-menu',
  'packages/kiosk-proactive',
  'packages/stage-ui/src/components/scenarios/customer-session',

  'apps/stage-web/src/pages/kiosk',
  'apps/stage-web/src/pages/settings/system/kiosk-proactive.vue',
  'apps/stage-web/src/pages/settings/system/ordering-service.vue',

  'apps/server/src/routes/kiosk',
  'apps/server/src/services/domain/kiosk',
  'apps/server/src/services/domain/kiosk-audio',
  'apps/server/src/services/domain/kiosk-media',
  'apps/server/src/services/domain/kiosk-character-assets',
]

const DISCOVERY_KEYWORDS
  = /webnavior|kiosk|ordering|order-menu|customer-session|proactive/i

const CAPABILITY_KEYWORDS
  = /speech|tts|asr|transcrib|audio|mediapipe|vision|llm|chat|session|order|webmcp|record|camera|vad/i

function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join('/')
}

function exists(p) {
  try {
    return fs.existsSync(p)
  }
  catch {
    return false
  }
}

function walkFiles(start, { sourceOnly = true } = {}) {
  const out = []

  if (!exists(start))
    return out

  const st = fs.statSync(start)

  if (st.isFile()) {
    if (!sourceOnly || SOURCE_EXT.has(path.extname(start)))
      out.push(start)
    return out
  }

  const stack = [start]

  while (stack.length) {
    const dir = stack.pop()
    let entries = []

    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    }
    catch {
      continue
    }

    for (const ent of entries) {
      if (ent.isDirectory() && SKIP_DIRS.has(ent.name))
        continue

      const full = path.join(dir, ent.name)

      if (ent.isDirectory()) {
        stack.push(full)
      }
      else if (
        ent.isFile()
        && (!sourceOnly || SOURCE_EXT.has(path.extname(ent.name)))
      ) {
        out.push(full)
      }
    }
  }

  return out
}

function findWorkspacePackages() {
  const bases = [
    'apps',
    'packages',
    'services',
    'plugins',
    'engines',
    'integrations',
  ]

  const map = new Map()

  for (const base of bases) {
    const abs = path.join(ROOT, base)

    if (!exists(abs))
      continue

    const stack = [abs]

    while (stack.length) {
      const dir = stack.pop()
      let entries = []

      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      }
      catch {
        continue
      }

      const pkgFile = path.join(dir, 'package.json')

      if (exists(pkgFile)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))

          if (pkg.name)
            map.set(pkg.name, dir)
        }
        catch {}
      }

      for (const ent of entries) {
        if (!ent.isDirectory() || SKIP_DIRS.has(ent.name))
          continue

        stack.push(path.join(dir, ent.name))
      }
    }
  }

  return map
}

const workspacePackages = findWorkspacePackages()

const workspaceRoots = [...workspacePackages.entries()]
  .map(([name, dir]) => ({
    name,
    dir: path.resolve(dir),
  }))
  .sort((a, b) => b.dir.length - a.dir.length)

function workspaceForFile(file) {
  const abs = path.resolve(file)

  return workspaceRoots.find(
    w => abs === w.dir || abs.startsWith(w.dir + path.sep),
  ) ?? null
}

function workspaceForImport(spec) {
  let best = null

  for (const [name, dir] of workspacePackages) {
    if (spec === name || spec.startsWith(`${name}/`)) {
      if (!best || name.length > best.name.length)
        best = { name, dir }
    }
  }

  return best
}

const builtinSet = new Set([
  ...builtinModules,
  ...builtinModules.map(x => `node:${x}`),
])

function extractImports(text) {
  const specs = new Set()

  const patterns = [
    /(?:import|export)[^'"\r\n]*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]

  for (const re of patterns) {
    let m

    while ((m = re.exec(text)))
      specs.add(m[1])
  }

  return [...specs]
}

function extractEndpoints(text) {
  const values = new Set()

  const patterns = [
    /https?:\/\/[^\s'"`<>)}\]]+/g,
    /['"`]((?:\/api\/|\/ws\/|\/v1\/)[^'"`\s${}]*)['"`]/g,
  ]

  for (const re of patterns) {
    let m

    while ((m = re.exec(text)))
      values.add(m[1] ?? m[0])
  }

  return [...values]
}

function classifyImport(spec, file) {
  if (builtinSet.has(spec)) {
    return {
      kind: 'node-builtin',
      target: spec,
    }
  }

  const ws = workspaceForImport(spec)

  if (ws) {
    return {
      kind: 'workspace-package',
      target: ws.name,
      targetRoot: rel(ws.dir),
      spec,
    }
  }

  if (spec.startsWith('.')) {
    const absTarget = path.resolve(path.dirname(file), spec)

    const targetWs = workspaceRoots.find(
      w => absTarget === w.dir || absTarget.startsWith(w.dir + path.sep),
    )

    const sourceWs = workspaceForFile(file)

    if (targetWs && (!sourceWs || targetWs.name !== sourceWs.name)) {
      return {
        kind: 'cross-workspace-relative',
        target: targetWs.name,
        targetRoot: rel(targetWs.dir),
        spec,
      }
    }

    return {
      kind: 'relative',
      target: spec,
    }
  }

  if (
    spec.startsWith('@/')
    || spec.startsWith('~/')
    || spec.startsWith('#')
  ) {
    return {
      kind: 'alias',
      target: spec,
    }
  }

  return {
    kind: 'external-package',
    target: spec,
  }
}

function gitPathExistsAtBaseline(repoRelativePath) {
  if (!baseline)
    return null

  try {
    execFileSync(
      'git',
      ['cat-file', '-e', `${baseline}:${repoRelativePath}`],
      {
        cwd: ROOT,
        stdio: 'ignore',
      },
    )

    return true
  }
  catch {
    return false
  }
}

const explicitFiles = new Set()
const foundScopeRoots = []

for (const item of EXPLICIT_SCOPE) {
  const abs = path.join(ROOT, item)

  if (!exists(abs))
    continue

  foundScopeRoots.push(item)

  for (const file of walkFiles(abs))
    explicitFiles.add(file)
}

const records = []

for (const file of [...explicitFiles].sort()) {
  let text

  try {
    text = fs.readFileSync(file, 'utf8')
  }
  catch {
    continue
  }

  const imports = extractImports(text)
    .map(spec => ({
      spec,
      ...classifyImport(spec, file),
    }))

  const endpoints = extractEndpoints(text)

  records.push({
    file: rel(file),
    workspace: workspaceForFile(file)?.name ?? null,
    imports,
    endpoints,
    capabilityCandidate: CAPABILITY_KEYWORDS.test(rel(file)),
  })
}

const workspaceReuse = new Map()
const crossWorkspaceRelative = []
const externalImports = new Map()
const endpoints = new Map()
const capabilityCandidates = []

for (const rec of records) {
  if (rec.capabilityCandidate)
    capabilityCandidates.push(rec.file)

  for (const imp of rec.imports) {
    if (imp.kind === 'workspace-package') {
      const key = imp.target

      if (!workspaceReuse.has(key)) {
        workspaceReuse.set(key, {
          count: 0,
          files: new Set(),
          specs: new Set(),
          targetRoot: imp.targetRoot,
        })
      }

      const row = workspaceReuse.get(key)

      row.count++
      row.files.add(rec.file)
      row.specs.add(imp.spec)
    }
    else if (imp.kind === 'cross-workspace-relative') {
      crossWorkspaceRelative.push({
        file: rec.file,
        spec: imp.spec,
        target: imp.target,
        targetRoot: imp.targetRoot,
      })
    }
    else if (imp.kind === 'external-package') {
      if (!externalImports.has(imp.target)) {
        externalImports.set(imp.target, {
          count: 0,
          files: new Set(),
        })
      }

      const row = externalImports.get(imp.target)

      row.count++
      row.files.add(rec.file)
    }
  }

  for (const ep of rec.endpoints) {
    if (!endpoints.has(ep))
      endpoints.set(ep, new Set())

    endpoints.get(ep).add(rec.file)
  }
}

// Find suspicious Webnavior-related paths outside our explicit scope.
// These files are only listed, not deeply analyzed here.
const discoveryBases = [
  'apps',
  'packages',
  'services',
]

const discoveredOutsideScope = []

for (const base of discoveryBases) {
  const abs = path.join(ROOT, base)

  if (!exists(abs))
    continue

  for (const file of walkFiles(abs)) {
    if (explicitFiles.has(file))
      continue

    const r = rel(file)

    if (DISCOVERY_KEYWORDS.test(r))
      discoveredOutsideScope.push(r)
  }
}

const bypassSignals = []

for (const [pkg, info] of externalImports) {
  if (
    /mediapipe/i.test(pkg)
    && workspacePackages.has('@proj-airi/model-driver-mediapipe')
  ) {
    bypassSignals.push({
      type: 'possible-wrapper-bypass',
      signal: `Direct MediaPipe dependency: ${pkg}`,
      files: [...info.files],
      note:
        'Repo also contains @proj-airi/model-driver-mediapipe; '
        + 'verify whether direct SDK use is intentional.',
    })
  }

  if (/^(?:openai|@ai-sdk\/|ollama|@anthropic-ai\/)/i.test(pkg)) {
    bypassSignals.push({
      type: 'direct-provider-sdk',
      signal: `Direct model/provider SDK dependency: ${pkg}`,
      files: [...info.files],
      note:
        'Verify whether this should go through the existing '
        + 'AIRI provider/runtime abstraction.',
    })
  }
}

for (const [ep, files] of endpoints) {
  if (/\/audio\/(?:speech|transcriptions)|\/v1\/audio\//i.test(ep)) {
    bypassSignals.push({
      type: 'direct-audio-api',
      signal: `Direct audio API reference: ${ep}`,
      files: [...files],
      note:
        'This may be legitimate API-level reuse, or it may bypass '
        + 'shared frontend speech/hearing runtime. Trace this path next.',
    })
  }
}

function mdEscape(s) {
  return String(s)
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ')
}

function sample(list, n = 5) {
  const arr = [...list]

  return arr.slice(0, n).join('<br>')
    + (arr.length > n
      ? `<br>... +${arr.length - n}`
      : '')
}

const lines = []

lines.push('# Webnavior dependency audit')
lines.push('')
lines.push(`Generated: ${new Date().toISOString()}`)
lines.push('')
lines.push(
  'This report is static dependency evidence, not a behavioral/runtime proof. '
  + 'It is intended to answer: "What does Webnavior actually import or call?"',
)
lines.push('')

if (baseline) {
  lines.push(`Baseline: \`${mdEscape(baseline)}\``)
  lines.push('')
}

lines.push('## Scope')
lines.push('')

for (const s of foundScopeRoots)
  lines.push(`- \`${s}\``)

lines.push('')
lines.push('## Summary')
lines.push('')
lines.push(`- Source files scanned: **${records.length}**`)
lines.push(`- Reused workspace packages: **${workspaceReuse.size}**`)
lines.push(
  `- Cross-workspace relative imports: **${crossWorkspaceRelative.length}**`,
)
lines.push(`- Direct external package imports: **${externalImports.size}**`)
lines.push(
  `- Distinct HTTP/WebSocket/API references: **${endpoints.size}**`,
)
lines.push(
  `- Capability-like local files in scope: **${capabilityCandidates.length}**`,
)
lines.push(
  `- Path-matched candidates outside explicit scope: `
  + `**${discoveredOutsideScope.length}**`,
)
lines.push('')

lines.push('## Workspace reuse')
lines.push('')
lines.push(
  '| Workspace package | Existed at baseline | Importing files | '
  + 'Import refs | Sample files |',
)
lines.push('| --- | --- | ---: | ---: | --- |')

for (
  const [name, info]
  of [...workspaceReuse.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
) {
  let existed = 'n/a'

  if (baseline) {
    const pkgJson = `${info.targetRoot}/package.json`
    existed = gitPathExistsAtBaseline(pkgJson)
      ? 'yes'
      : 'no'
  }

  lines.push(
    `| \`${mdEscape(name)}\` `
    + `| ${existed} `
    + `| ${info.files.size} `
    + `| ${info.count} `
    + `| ${mdEscape(sample(info.files))} |`,
  )
}

if (!workspaceReuse.size)
  lines.push('| _none_ | | | | |')

lines.push('')

lines.push('## Cross-workspace relative imports')
lines.push('')

if (crossWorkspaceRelative.length) {
  lines.push('| File | Import | Target workspace |')
  lines.push('| --- | --- | --- |')

  for (const x of crossWorkspaceRelative) {
    lines.push(
      `| \`${mdEscape(x.file)}\` `
      + `| \`${mdEscape(x.spec)}\` `
      + `| \`${mdEscape(x.target)}\` |`,
    )
  }
}
else {
  lines.push('_None found._')
}

lines.push('')

lines.push('## Direct external package imports')
lines.push('')
lines.push('| Package | Files | Import refs | Sample files |')
lines.push('| --- | ---: | ---: | --- |')

for (
  const [name, info]
  of [...externalImports.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
) {
  lines.push(
    `| \`${mdEscape(name)}\` `
    + `| ${info.files.size} `
    + `| ${info.count} `
    + `| ${mdEscape(sample(info.files))} |`,
  )
}

if (!externalImports.size)
  lines.push('| _none_ | | | |')

lines.push('')

lines.push('## HTTP / WebSocket / API references')
lines.push('')

if (endpoints.size) {
  lines.push('| Endpoint / URL | Files | Sample files |')
  lines.push('| --- | ---: | --- |')

  for (
    const [ep, files]
    of [...endpoints.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
  ) {
    lines.push(
      `| \`${mdEscape(ep)}\` `
      + `| ${files.size} `
      + `| ${mdEscape(sample(files))} |`,
    )
  }
}
else {
  lines.push('_None found._')
}

lines.push('')

lines.push('## Potential bypass / parallel-implementation signals')
lines.push('')

if (bypassSignals.length) {
  for (const s of bypassSignals) {
    lines.push(`- **${mdEscape(s.signal)}**`)
    lines.push(`  - ${mdEscape(s.note)}`)
    lines.push(`  - Files: ${mdEscape(sample(s.files, 8))}`)
  }
}
else {
  lines.push('_No obvious signals from the current heuristics._')
}

lines.push('')

lines.push('## Capability-like local files in Webnavior scope')
lines.push('')

for (const f of capabilityCandidates.sort())
  lines.push(`- \`${mdEscape(f)}\``)

if (!capabilityCandidates.length)
  lines.push('_None found._')

lines.push('')

lines.push('## Candidates outside explicit scope')
lines.push('')
lines.push(
  'These are path-name matches only. '
  + 'They help find Webnavior code that may have leaked into shared AIRI areas.',
)
lines.push('')

for (
  const f
  of discoveredOutsideScope
    .sort()
    .slice(0, 250)
) {
  lines.push(`- \`${mdEscape(f)}\``)
}

if (discoveredOutsideScope.length > 250) {
  lines.push(
    `- ... ${discoveredOutsideScope.length - 250} more; `
    + 'see JSON output or refine the scope.',
  )
}

if (!discoveredOutsideScope.length)
  lines.push('_None found._')

lines.push('')

const json = {
  generatedAt: new Date().toISOString(),
  baseline,

  scope: foundScopeRoots,

  summary: {
    sourceFilesScanned: records.length,
    reusedWorkspacePackages: workspaceReuse.size,
    crossWorkspaceRelativeImports: crossWorkspaceRelative.length,
    directExternalPackages: externalImports.size,
    endpointReferences: endpoints.size,
    capabilityCandidates: capabilityCandidates.length,
    discoveredOutsideScope: discoveredOutsideScope.length,
  },

  workspaceReuse: Object.fromEntries(
    [...workspaceReuse.entries()]
      .map(([name, info]) => [
        name,
        {
          count: info.count,
          files: [...info.files].sort(),
          specs: [...info.specs].sort(),
          targetRoot: info.targetRoot,
          existedAtBaseline: baseline
            ? gitPathExistsAtBaseline(
                `${info.targetRoot}/package.json`,
              )
            : null,
        },
      ]),
  ),

  crossWorkspaceRelative,

  externalImports: Object.fromEntries(
    [...externalImports.entries()]
      .map(([name, info]) => [
        name,
        {
          count: info.count,
          files: [...info.files].sort(),
        },
      ]),
  ),

  endpoints: Object.fromEntries(
    [...endpoints.entries()]
      .map(([ep, files]) => [
        ep,
        [...files].sort(),
      ]),
  ),

  bypassSignals,

  capabilityCandidates:
    capabilityCandidates.sort(),

  discoveredOutsideScope:
    discoveredOutsideScope.sort(),

  records,
}

fs.mkdirSync(OUT_DIR, {
  recursive: true,
})

fs.writeFileSync(
  OUT_MD,
  `${lines.join('\n')}\n`,
)

fs.writeFileSync(
  OUT_JSON,
  `${JSON.stringify(json, null, 2)}\n`,
)

console.info(`Wrote ${rel(OUT_MD)}`)
console.info(`Wrote ${rel(OUT_JSON)}`)
console.info(
  `Scanned ${records.length} source files `
  + `across ${foundScopeRoots.length} scope roots.`,
)
console.info(
  `Found ${workspaceReuse.size} reused workspace packages `
  + `and ${externalImports.size} direct external packages.`,
)
