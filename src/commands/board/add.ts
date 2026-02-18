import { Args, Command, Flags } from '@oclif/core'
import { createInterface } from 'node:readline/promises'
import { join } from 'node:path'
import { loadConfig, saveConfig, addBoard } from '../../config-manager.js'
import { validateBoardAddress } from '../../board-validator.js'
import { applyCommunityDefaultsToBoard, getCommunityDefaultsPreset, loadCommunityDefaultsPreset } from '../../community-defaults.js'
import type { BoardConfig } from '../../types.js'

export default class BoardAdd extends Command {
  static override args = {
    address: Args.string({
      description: 'Subplebbit address to add',
      required: true,
    }),
  }

  static override description = 'Add a board to the config'

  static override examples = [
    '5chan board add random.eth',
    '5chan board add tech.eth --bump-limit 500',
    '5chan board add flash.eth --per-page 30 --pages 1',
    '5chan board add my-board.eth --rpc-url ws://custom-host:9138',
    '5chan board add my-board.eth --apply-defaults',
    '5chan board add my-board.eth --skip-apply-defaults',
    '5chan board add my-board.eth --apply-defaults --defaults-preset ./my-preset.json',
  ]

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
    'apply-defaults': Flags.boolean({
      description: 'Apply preset defaults before adding to config',
    }),
    'skip-apply-defaults': Flags.boolean({
      description: 'Skip applying preset defaults before adding to config',
    }),
    'defaults-preset': Flags.file({
      description: 'Path to a custom preset JSON file',
      exists: true,
    }),
  }

  protected isInteractive(): boolean {
    return Boolean(process.stdin.isTTY && process.stdout.isTTY)
  }

  protected async promptApplyDefaults(address: string): Promise<boolean> {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    try {
      for (;;) {
        const answer = (await rl.question(
          `Apply 5chan preset defaults to "${address}"? [Y/n] `,
        )).trim().toLowerCase()

        if (answer === '' || answer === 'y' || answer === 'yes') return true
        if (answer === 'n' || answer === 'no') return false

        this.log('Please answer "y" or "n".')
      }
    } finally {
      rl.close()
    }
  }

  protected async resolveApplyDefaultsDecision(
    address: string,
    applyDefaultsFlag: boolean,
    skipApplyDefaultsFlag: boolean,
  ): Promise<boolean> {
    if (applyDefaultsFlag && skipApplyDefaultsFlag) {
      this.error('Cannot use both --apply-defaults and --skip-apply-defaults')
    }

    if (applyDefaultsFlag) return true
    if (skipApplyDefaultsFlag) return false

    if (!this.isInteractive()) {
      this.error(
        'Non-interactive mode requires --apply-defaults or --skip-apply-defaults',
      )
    }

    return this.promptApplyDefaults(address)
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(BoardAdd)
    const configPath = join(this.config.configDir, 'config.json')

    await validateBoardAddress(args.address, flags['rpc-url'])

    const shouldApplyDefaults = await this.resolveApplyDefaultsDecision(
      args.address,
      flags['apply-defaults'],
      flags['skip-apply-defaults'],
    )

    const preset = shouldApplyDefaults
      ? (flags['defaults-preset']
          ? await loadCommunityDefaultsPreset(flags['defaults-preset'])
          : await getCommunityDefaultsPreset())
      : undefined

    if (shouldApplyDefaults) {
      const activePreset = preset ?? await getCommunityDefaultsPreset()
      const applyResult = await applyCommunityDefaultsToBoard(args.address, flags['rpc-url'], activePreset)
      if (applyResult.applied) {
        this.log(
          `Applied board settings defaults (${applyResult.changedFields.join(', ')}) to "${args.address}"`,
        )
      } else {
        this.log(`Board settings defaults already present on "${args.address}"`)
      }
    } else {
      this.log(`Skipped applying preset defaults to "${args.address}"`)
    }

    let config = loadConfig(configPath)

    const board: BoardConfig = { address: args.address }
    if (preset) {
      const boardManagerDefaults = preset.boardManagerSettings
      if (boardManagerDefaults.perPage !== undefined) board.perPage = boardManagerDefaults.perPage
      if (boardManagerDefaults.pages !== undefined) board.pages = boardManagerDefaults.pages
      if (boardManagerDefaults.bumpLimit !== undefined) board.bumpLimit = boardManagerDefaults.bumpLimit
      if (boardManagerDefaults.archivePurgeSeconds !== undefined) {
        board.archivePurgeSeconds = boardManagerDefaults.archivePurgeSeconds
      }
    }
    if (flags['per-page'] !== undefined) board.perPage = flags['per-page']
    if (flags.pages !== undefined) board.pages = flags.pages
    if (flags['bump-limit'] !== undefined) board.bumpLimit = flags['bump-limit']
    if (flags['archive-purge-seconds'] !== undefined) board.archivePurgeSeconds = flags['archive-purge-seconds']

    config = addBoard(config, board)
    saveConfig(configPath, config)

    this.log(`Added board "${args.address}" to ${configPath}`)
  }
}
