import { Command } from '@oclif/core'
import { join } from 'node:path'
import { loadConfig } from '../../config-manager.js'

export default class BoardList extends Command {
  static override description = 'List all boards in the archiver config'

  async run(): Promise<void> {
    const configPath = join(this.config.configDir, 'config.json')
    const config = loadConfig(configPath)

    this.log(`Config: ${configPath}`)
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

      const suffix = overrides.length > 0 ? ` (${overrides.join(', ')})` : ''
      this.log(`  ${board.address}${suffix}`)
    }
  }
}
