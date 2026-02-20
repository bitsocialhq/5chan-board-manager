import { Command } from '@oclif/core'
import { loadConfig } from '../../config-manager.js'

export default class BoardList extends Command {
  static override description = 'List all boards in the config'

  static override examples = [
    '5chan board list',
  ]

  async run(): Promise<void> {
    const configDir = this.config.configDir
    const config = loadConfig(configDir)

    this.log(`Config: ${configDir}`)
    this.log(`RPC URL: ${config.rpcUrl ?? '(default: ws://localhost:9138)'}`)

    if (config.boards.length === 0) {
      this.log('\nNo boards configured. Use "5chan board add <address>" to add one.')
      return
    }

    this.log(`\nBoards (${config.boards.length}):`)
    for (const board of config.boards) {
      const overrides: string[] = []
      if (board.perPage !== undefined) overrides.push(`perPage=${board.perPage}`)
      if (board.pages !== undefined) overrides.push(`pages=${board.pages}`)
      if (board.bumpLimit !== undefined) overrides.push(`bumpLimit=${board.bumpLimit}`)
      if (board.archivePurgeSeconds !== undefined) overrides.push(`archivePurgeSeconds=${board.archivePurgeSeconds}`)
      if (board.moderationReasons !== undefined) {
        const reasonKeys = Object.keys(board.moderationReasons).join(', ')
        overrides.push(`moderationReasons={${reasonKeys}}`)
      }

      const suffix = overrides.length > 0 ? ` (${overrides.join(', ')})` : ''
      this.log(`  ${board.address}${suffix}`)
    }
  }
}
