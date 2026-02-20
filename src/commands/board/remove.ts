import { Args, Command } from '@oclif/core'
import { deleteBoardConfig } from '../../config-manager.js'

export default class BoardRemove extends Command {
  static override args = {
    address: Args.string({
      description: 'Subplebbit address to remove',
      required: true,
    }),
  }

  static override description = 'Remove a board from the config'

  static override examples = [
    '5chan board remove random.eth',
  ]

  async run(): Promise<void> {
    const { args } = await this.parse(BoardRemove)
    const configDir = this.config.configDir

    deleteBoardConfig(configDir, args.address)

    this.log(`Removed board "${args.address}" from ${configDir}`)
  }
}
