import { Args, Command, Flags } from '@oclif/core'
import { join } from 'node:path'
import { loadConfig, saveConfig, addBoard } from '../../config-manager.js'
import { validateBoardAddress } from '../../board-validator.js'
import type { BoardConfig } from '../../types.js'

export default class BoardAdd extends Command {
  static override args = {
    address: Args.string({
      description: 'Subplebbit address to add',
      required: true,
    }),
  }

  static override description = 'Add a board to the archiver config'

  static override flags = {
    'rpc-url': Flags.string({
      description: 'Plebbit RPC WebSocket URL (for validation)',
      env: 'PLEBBIT_RPC_WS_URL',
      default: 'ws://localhost:9138',
    }),
    'per-page': Flags.integer({
      description: 'Posts per page',
    }),
    pages: Flags.integer({
      description: 'Number of pages',
    }),
    'bump-limit': Flags.integer({
      description: 'Bump limit for threads',
    }),
    'archive-purge-seconds': Flags.integer({
      description: 'Seconds after archiving before purge',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(BoardAdd)
    const configPath = join(this.config.configDir, 'config.json')

    await validateBoardAddress(args.address, flags['rpc-url'])

    let config = loadConfig(configPath)

    const board: BoardConfig = { address: args.address }
    if (flags['per-page'] !== undefined) board.perPage = flags['per-page']
    if (flags.pages !== undefined) board.pages = flags.pages
    if (flags['bump-limit'] !== undefined) board.bumpLimit = flags['bump-limit']
    if (flags['archive-purge-seconds'] !== undefined) board.archivePurgeSeconds = flags['archive-purge-seconds']

    config = addBoard(config, board)
    saveConfig(configPath, config)

    this.log(`Added board "${args.address}" to ${configPath}`)
  }
}
