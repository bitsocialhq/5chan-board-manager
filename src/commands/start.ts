import { Command, Flags } from '@oclif/core'
import { loadConfig } from '../config-manager.js'
import { startBoardManagers } from '../board-managers.js'

export default class Start extends Command {
  static override description = 'Start board managers, watching the config directory for changes'

  static override examples = [
    '5chan start',
    '5chan start --config-dir /path/to/config',
  ]

  static override flags = {
    'config-dir': Flags.string({
      char: 'c',
      description: 'Path to config directory (overrides default)',
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Start)
    const configDir = flags['config-dir'] ?? this.config.configDir

    const config = loadConfig(configDir)

    if (config.boards.length === 0) {
      this.error('No boards configured. Use "5chan board add <address>" to add boards first.')
    }

    this.log(`Starting board managers for ${config.boards.length} board(s)...`)
    this.log(`Config: ${configDir}`)
    this.log(`Watching config directory for changes`)

    const manager = await startBoardManagers(configDir, config)

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
