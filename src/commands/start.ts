import { Command, Flags } from '@oclif/core'
import { join } from 'node:path'
import { loadConfig } from '../config-manager.js'
import { startBoardManagers } from '../board-managers.js'

export default class Start extends Command {
  static override description = 'Start board managers, watching the config file for changes'

  static override examples = [
    '5chan start',
    '5chan start --config /path/to/config.json',
  ]

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

    this.log(`Starting board managers for ${config.boards.length} board(s)...`)
    this.log(`Config: ${configPath}`)
    this.log(`Watching config file for changes`)

    const manager = await startBoardManagers(configPath, config)

    const started = manager.boardManagers.size
    const failed = manager.errors.size
    this.log(`Started ${started} board manager(s)${failed > 0 ? `, ${failed} failed` : ''}`)
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
