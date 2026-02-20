import { Command } from '@oclif/core'
import { loadConfig } from '../../config-manager.js'

export default class BoardList extends Command {
  static override description = 'List all board addresses'

  static override examples = [
    '5chan board list',
  ]

  async run(): Promise<void> {
    const configDir = this.config.configDir
    const config = loadConfig(configDir)

    if (config.boards.length === 0) {
      this.log('No boards configured. Use "5chan board add <address>" to add one.')
      return
    }

    for (const board of config.boards) {
      this.log(board.address)
    }
  }
}
