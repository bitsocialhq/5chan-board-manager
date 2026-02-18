#!/usr/bin/env node

import { loadMultiConfig } from './multi-config.js'
import { startMultiArchiver } from './multi-runner.js'

const configPath = getConfigPath()

if (!configPath) {
  console.error('Usage: 5chan-archiver-multi <config.json>')
  console.error('       5chan-archiver-multi --config <config.json>')
  process.exit(1)
}

const config = loadMultiConfig(configPath)
console.log(`Starting archivers for ${config.boards.length} board(s)...`)

const result = await startMultiArchiver(config)

const started = result.archivers.size
const failed = result.errors.size
console.log(`Started ${started} archiver(s)${failed > 0 ? `, ${failed} failed` : ''}`)
for (const [address, err] of result.errors) {
  console.error(`  FAILED: ${address} — ${err.message}`)
}

let shuttingDown = false

async function shutdown(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.log('Shutting down...')
  await result.stop()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

function getConfigPath(): string | undefined {
  const args = process.argv.slice(2)
  const configIdx = args.indexOf('--config')
  if (configIdx !== -1 && args[configIdx + 1]) {
    return args[configIdx + 1]
  }
  // First positional argument (not a flag)
  for (const arg of args) {
    if (!arg.startsWith('--')) return arg
  }
  return undefined
}
