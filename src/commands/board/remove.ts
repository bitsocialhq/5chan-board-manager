import { Args, Command } from '@oclif/core'
import { join } from 'node:path'
import { loadConfig, saveConfig, removeBoard } from '../../config-manager.js'

export default class BoardRemove extends Command {
  static override args = {
    address: Args.string({
      description: 'Subplebbit address to remove',
      required: true,
    }),
  }

  static override description = 'Remove a board from the archiver config'

  async run(): Promise<void> {
    const { args } = await this.parse(BoardRemove)
    const configPath = join(this.config.configDir, 'config.json')

    const config = loadConfig(configPath)
    const updated = removeBoard(config, args.address)
    saveConfig(configPath, updated)

    this.log(`Removed board "${args.address}" from ${configPath}`)
  }
}
