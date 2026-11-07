import process from 'node:process'

import { readFile } from 'node:fs/promises'

import { inspectCatalogPrices } from '../domain/catalogDiagnostics'

async function main() {
  const [file, mode] = process.argv.slice(2)
  if (!file || file === '--help' || (mode !== undefined && mode !== '--strict') || process.argv.length > 4) {
    process.stdout.write('Usage: pnpm -F @proj-airi/order-menu-server menu:check <menu.json> [--strict]\n')
    process.exitCode = file === '--help' ? 0 : 2
  }
  else {
    try {
      const report = inspectCatalogPrices(JSON.parse(await readFile(file, 'utf8')))
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
      process.exitCode = report.valid ? (mode === '--strict' && report.warningCount ? 1 : 0) : 2
    }
    catch {
      // No source mutation or guessed recovery: malformed files must be corrected
      // by the maintainer before this report can establish anything about prices.
      process.stderr.write('Unable to read menu JSON. Expected items with id, name, numeric price and description.\n')
      process.exitCode = 2
    }
  }
}

void main()
