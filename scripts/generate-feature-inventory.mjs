#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Generates a compact, deterministic map of AIRI's discoverable feature
 * surface. It intentionally reads registrations, manifests, and conventions
 * rather than following implementation imports or inferring behavior.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const outputFile = path.join(root, 'docs/generated/feature-inventory.md')
const ignoredDirectories = new Set(['.git', '.cache', '.next', '.nuxt', '.turbo', '.vite', 'build', 'coverage', 'dist', 'node_modules', 'out'])
const sourceExtensions = new Set(['.md', '.vue'])

function relative(file) {
  return path.relative(root, file).split(path.sep).join('/')
}

function read(file) {
  return fs.readFileSync(file, 'utf8')
}

function exists(file) {
  return fs.existsSync(file)
}

function walk(directory, predicate = () => true, files = []) {
  if (!exists(directory))
    return files

  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name))
        walk(path.join(directory, entry.name), predicate, files)
      continue
    }

    const file = path.join(directory, entry.name)
    if (entry.isFile() && predicate(file))
      files.push(file)
  }

  return files
}

function markdown(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', '<br>')
}

function table(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(markdown).join(' | ')} |`),
  ].join('\n')
}

function heading(title, body) {
  return body.length ? `## ${title}\n\n${body}\n` : ''
}

function lineNumber(text, needle) {
  const index = text.indexOf(needle)
  return index < 0 ? '' : `:${text.slice(0, index).split('\n').length}`
}

function routePath(file, pagesDirectory) {
  const segments = path.relative(pagesDirectory, file).split(path.sep)
  const filename = segments.pop().replace(/\.(vue|md)$/, '')
  if (filename !== 'index')
    segments.push(filename)

  const route = segments
    .map(segment => segment
      .replace(/^\[\.\.\.(.+)\]$/, ':$1(.*)')
      .replace(/^\[\[\.\.\.(.+)\]\]$/, ':$1(.*)?')
      .replace(/^\[(.+)\]$/, ':$1'))
    .join('/')

  return `/${route}`.replace(/\/$/, '') || '/'
}

function collectPages() {
  const routeRoots = [
    ['Web', 'apps/stage-web/src/pages', 'configured by apps/stage-web/vite.config.ts'],
    ['Web and Desktop', 'packages/stage-pages/src/pages', 'configured by both app Vite route folders'],
    ['Desktop', 'apps/stage-tamagotchi/src/renderer/pages', 'configured by apps/stage-tamagotchi/electron.vite.config.ts'],
    ['Kiosk', 'apps/stage-kiosk/src/pages', 'configured by apps/stage-kiosk/vite.config.ts'],
    ['Pocket', 'apps/stage-pocket/src/pages', 'configured by apps/stage-pocket/vite.config.ts'],
  ]
  const pages = []

  for (const [surface, sourceRoot, registration] of routeRoots) {
    const directory = path.join(root, sourceRoot)
    for (const file of walk(directory, file => sourceExtensions.has(path.extname(file)) && !relative(file).includes('/components/'))) {
      const source = read(file).slice(0, 2_000)
      const route = routePath(file, directory)
      const category = route.startsWith('/devtools')
        ? 'Devtools page'
        : source.includes('layout: settings') || route.startsWith('/settings')
          ? 'Settings page'
          : 'Frontend page'
      pages.push([route, category, relative(file), registration, surface])
    }
  }

  return pages.sort((a, b) => a[4].localeCompare(b[4]) || a[0].localeCompare(b[0]))
}

function collectProviders() {
  const registryFile = path.join(root, 'packages/stage-ui/src/libs/providers/providers/index.ts')
  const registry = read(registryFile)
  const registrations = [...registry.matchAll(/^import ['"](.+)['"]$/gm)]
  const rows = []

  for (const [, specifier] of registrations) {
    const moduleFile = path.resolve(path.dirname(registryFile), specifier, 'index.ts')
    if (!exists(moduleFile))
      continue
    const source = read(moduleFile)
    const providerMatches = providerDefinitionBodies(source)
    const registration = `${relative(registryFile)}${lineNumber(registry, `'${specifier}'`)}`

    for (const body of providerMatches) {
      const rawId = body.match(/\bid:\s*([^,\n]+)/)?.[1]?.trim()
      const id = resolveProviderId(rawId, source) ?? path.basename(specifier)
      const tasks = body.match(/\btasks:\s*\[([^\]]*)\]/)?.[1]
        ?.match(/['"]([^'"]+)['"]/g)
        ?.map(value => value.slice(1, -1))
        .join(', ') ?? 'unspecified'
      rows.push([id, tasks, relative(moduleFile), registration, 'Loaded by provider registry'])
    }
  }

  return [...rows, ...collectLegacyProviders()].sort((a, b) => a[0].localeCompare(b[0]))
}

function providerDefinitionBodies(source) {
  const bodies = []
  for (const match of source.matchAll(/defineProvider(?:<[^>]*>)?\s*\(/g)) {
    const objectStart = source.indexOf('{', match.index + match[0].length)
    if (objectStart < 0)
      continue
    let depth = 0
    let quote = ''
    for (let index = objectStart; index < source.length; index += 1) {
      const character = source[index]
      if (quote) {
        if (character === '\\')
          index += 1
        else if (character === quote)
          quote = ''
        continue
      }
      if (character === '\'' || character === '"' || character === '`') {
        quote = character
        continue
      }
      if (character === '{')
        depth += 1
      if (character === '}')
        depth -= 1
      if (depth === 0) {
        bodies.push(source.slice(objectStart + 1, index))
        break
      }
    }
  }
  return bodies
}

function resolveProviderId(rawId, source) {
  if (!rawId)
    return undefined
  const literal = rawId.match(/^['"]([^'"]+)['"]$/)?.[1]
  if (literal)
    return literal
  return source.match(new RegExp(`\\b${rawId}\\s*=\\s*['"]([^'"]+)['"]`))?.[1]
}

function collectLegacyProviders() {
  const file = path.join(root, 'packages/stage-ui/src/stores/providers.ts')
  const source = read(file)
  const start = source.indexOf('const providerMetadata:')
  const end = source.indexOf('function createVisionProviderMetadata')
  if (start < 0 || end < 0)
    return []

  const metadata = source.slice(start, end)
  const starts = [...metadata.matchAll(/^ {4}['"]?([a-z0-9-]+)['"]?:\s*(?:\{|[A-Z]+\()/gim)]
  return starts.map((match, index) => {
    const body = metadata.slice(match.index, starts[index + 1]?.index)
    const category = body.match(/\bcategory:\s*['"]([^'"]+)['"]/)?.[1] ?? 'unspecified'
    const tasks = body.match(/\btasks:\s*\[([^\]]*)\]/)?.[1]
      ?.match(/['"]([^'"]+)['"]/g)
      ?.map(value => value.slice(1, -1))
      .join(', ') ?? category
    return [match[1], tasks, relative(file), `${relative(file)}${lineNumber(source, match[0])}`, 'Static provider metadata used by providers store']
  })
}

function collectStores() {
  const roots = [
    'packages/stage-ui/src/stores',
    'apps/stage-web/src/stores',
    'apps/stage-tamagotchi/src/renderer/stores',
  ]
  const rows = []
  for (const sourceRoot of roots) {
    for (const file of walk(path.join(root, sourceRoot), file => file.endsWith('.ts') && !file.endsWith('.test.ts'))) {
      const source = read(file)
      const storeName = source.match(/defineStore\(['"]([^'"]+)['"]/)?.[1]
      if (storeName)
        rows.push([storeName, 'Store', relative(file), 'defineStore()', sourceRoot.includes('stage-ui') ? 'Shared stage UI' : sourceRoot.includes('stage-web') ? 'Web' : 'Desktop'])
    }
  }
  return rows.sort((a, b) => a[0].localeCompare(b[0]))
}

function collectModules() {
  const exportsFile = path.join(root, 'packages/stage-ui/src/stores/modules/index.ts')
  const source = read(exportsFile)
  return [...source.matchAll(/^export \* from ['"](.+)['"]$/gm)]
    .map(([, specifier]) => {
      const file = path.resolve(path.dirname(exportsFile), `${specifier}.ts`)
      return [path.basename(specifier), 'Registered module', relative(file), `${relative(exportsFile)}${lineNumber(source, specifier)}`, 'Exported from shared module entry point']
    })
    .sort((a, b) => a[0].localeCompare(b[0]))
}

function collectServerRoutes() {
  const appFile = path.join(root, 'apps/server/src/app.ts')
  const source = read(appFile)
  const rows = []
  for (const match of source.matchAll(/\.route\(\s*['"]([^'"]+)['"]\s*,\s*(?:await\s+)?([A-Za-z][A-Za-z0-9.]*)/g)) {
    rows.push([match[2], 'Backend route group', match[1], `${relative(appFile)}:${source.slice(0, match.index).split('\n').length}`, 'Mounted by server app'])
  }
  for (const match of source.matchAll(/app\.(get|post)\(\s*['"]([^'"]+)['"]/g)) {
    rows.push([match[2], `${match[1].toUpperCase()} endpoint`, match[2], `${relative(appFile)}:${source.slice(0, match.index).split('\n').length}`, 'Mounted directly by server app'])
  }
  return rows.sort((a, b) => a[2].localeCompare(b[2]) || a[0].localeCompare(b[0]))
}

function collectServerServices() {
  const appFile = path.join(root, 'apps/server/src/app.ts')
  const source = read(appFile)
  const rows = []
  for (const match of source.matchAll(/import \{ ([^}]+) \} from ['"](\.\/services\/[^'"]+)['"]/g)) {
    for (const name of match[1].split(',').map(value => value.trim()).filter(value => value.startsWith('create') || value.startsWith('start'))) {
      rows.push([name, 'Backend service', `${match[2].replace(/^\.\//, '')}`, `${relative(appFile)}${lineNumber(source, match[0])}`, 'Composed by server app'])
    }
  }
  return rows.sort((a, b) => a[0].localeCompare(b[0]))
}

function collectFeatureDirectories() {
  const directories = [
    ['Stage UI scenarios', 'packages/stage-ui/src/components/scenarios', 'Shared UI feature scenarios'],
    ['Stage UI modules', 'packages/stage-ui/src/stores/modules', 'Shared orchestration modules'],
    ['Stage UI workers', 'packages/stage-ui/src/workers', 'Browser/background runtime workers'],
    ['Desktop services', 'apps/stage-tamagotchi/src/main/services/airi', 'Desktop main-process services'],
    ['Server routes', 'apps/server/src/routes', 'Server route groups'],
    ['Server domain services', 'apps/server/src/services/domain', 'Server business services'],
  ]
  const rows = []
  for (const [category, directory, description] of directories) {
    const absolute = path.join(root, directory)
    if (!exists(absolute))
      continue
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true }).filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name)))
      rows.push([entry.name, category, `${directory}/${entry.name}`, 'Filesystem convention', description])
  }
  return rows
}

function collectPackages() {
  const roots = ['apps', 'engines', 'integrations', 'packages', 'plugins', 'services']
  const rows = []
  for (const workspaceRoot of roots) {
    for (const file of walk(path.join(root, workspaceRoot), file => path.basename(file) === 'package.json')) {
      const manifest = JSON.parse(read(file))
      const category = workspaceRoot === 'plugins' ? 'Plugin' : `Workspace ${workspaceRoot.slice(0, -1)}`
      const reachability = workspaceRoot === 'plugins'
        ? 'Installable/discoverable plugin package'
        : 'Declared by pnpm-workspace.yaml'
      rows.push([manifest.name ?? path.basename(path.dirname(file)), category, relative(path.dirname(file)), 'package.json', reachability])
    }
  }
  return rows.sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]))
}

function main() {
  const sections = [
    heading('Frontend routes and pages', table(['Route', 'Category', 'Main path', 'Registration', 'Reachability'], collectPages())),
    heading('Registered providers', table(['Name', 'Tasks / type', 'Main path', 'Registration', 'Reachability'], collectProviders())),
    heading('Registered modules', table(['Name', 'Category', 'Main path', 'Registration', 'Reachability'], collectModules())),
    heading('Major stores', table(['Name', 'Category', 'Main path', 'Registration', 'Reachability'], collectStores())),
    heading('Backend API routes', table(['Name', 'Category', 'Main path', 'Registration', 'Reachability'], collectServerRoutes())),
    heading('Backend services', table(['Name', 'Category', 'Main path', 'Registration', 'Reachability'], collectServerServices())),
    heading('Major feature directories and workers', table(['Name', 'Category', 'Main path', 'Registration', 'Reachability'], collectFeatureDirectories())),
    heading('Workspaces and plugins', table(['Name', 'Category', 'Main path', 'Registration', 'Reachability'], collectPackages())),
  ].filter(Boolean)

  const document = [
    '# Feature inventory',
    '',
    '> Generated by `node scripts/generate-feature-inventory.mjs`. Do not edit by hand.',
    '',
    'This is a registration and metadata inventory, not a behavioral audit. Items are included only when they are discoverable from configured route folders, registry entry points, server composition, manifests, or documented filesystem conventions.',
    '',
    ...sections,
  ].join('\n')

  fs.mkdirSync(path.dirname(outputFile), { recursive: true })
  fs.writeFileSync(outputFile, document)
  console.log(`Wrote ${relative(outputFile)}`)
}

main()
