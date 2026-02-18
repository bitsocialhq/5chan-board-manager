import { Command, Flags } from '@oclif/core'
import { join } from 'node:path'
import { loadConfig } from '../config-manager.js'
import { startArchiverManager } from '../archiver-manager.js'

export default class Start extends Command {
  static override description = 'Start the archiver, watching the config file for changes'

  static override flags = {
    config: Flags.string({
      char: 'c',
      description: 'Path to config file (overrides default)',
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Start)
    const configPath = flags.config ?? join(this.config.configDir, 'config.json')

    const config = loadConfig(configPath)

    if (config.boards.length === 0) {
      this.error('No boards configured. Use "5chan board add <address>" to add boards first.')
    }

    this.log(`Starting archivers for ${config.boards.length} board(s)...`)
    this.log(`Config: ${configPath}`)
    this.log(`Watching config file for changes`)

    const manager = await startArchiverManager(configPath, config)

    const started = manager.archivers.size
    const failed = manager.errors.size
    this.log(`Started ${started} archiver(s)${failed > 0 ? `, ${failed} failed` : ''}`)
    for (const [address, err] of manager.errors) {
      this.warn(`FAILED: ${address} — ${err.message}`)
    }

    let shuttingDown = false

    const shutdown = async (): Promise<void> => {
      if (shuttingDown) return
      shuttingDown = true
      this.log('Shutting down...')
      await manager.stop()
      process.exit(0)
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  }
}
