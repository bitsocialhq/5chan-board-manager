import { Args, Command, Flags } from '@oclif/core'
import { loadBoardConfig, boardConfigPath, saveBoardConfig, updateBoardConfig } from '../../config-manager.js'
import { isNonExistentFlagsError } from '../../parse-utils.js'
import type { BoardConfig } from '../../types.js'

/** Maps kebab-case CLI flag names to camelCase BoardConfig field names */
const RESETTABLE_FIELDS: Record<string, keyof Omit<BoardConfig, 'address'>> = {
  'per-page': 'perPage',
  'pages': 'pages',
  'bump-limit': 'bumpLimit',
  'archive-purge-seconds': 'archivePurgeSeconds',
  'moderation-reasons': 'moderationReasons',
}

export default class BoardEdit extends Command {
  static override args = {
    address: Args.string({
      description: 'Board address to edit',
      required: true,
    }),
  }

  static override description = `Edit 5chan settings for an existing board

This command configures how 5chan manages the board (pagination, bump limits, archiving).
To edit board settings (title, description, rules, etc.), use a WebUI or bitsocial-cli:
https://github.com/bitsocialhq/bitsocial-cli#bitsocial-community-edit-address`

  static override examples = [
    '5chan board edit tech.eth --bump-limit 500',
    '5chan board edit flash.eth --per-page 30 --pages 1',
    '5chan board edit random.eth --reset per-page,bump-limit',
    '5chan board edit random.eth --per-page 20 --reset bump-limit',
    '5chan board edit random.eth --reset moderation-reasons',
  ]

  static override flags = {
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
    reset: Flags.string({
      description: 'Comma-separated fields to reset to defaults (per-page, pages, bump-limit, archive-purge-seconds, moderation-reasons)',
    }),
  }

  private async parseWithUnknownFlagCheck() {
    try {
      return await this.parse(BoardEdit)
    } catch (err) {
      if (isNonExistentFlagsError(err)) {
        this.error(
          `Unknown option${err.flags.length === 1 ? '' : 's'}: ${err.flags.join(', ')}\n\n` +
          '"board edit" only manages 5chan settings (pagination, bump limits, archiving).\n' +
          'Valid flags: --per-page, --pages, --bump-limit, --archive-purge-seconds, --reset\n\n' +
          'To edit board settings (title, description, rules, etc.), use a WebUI or bitsocial-cli:\n' +
          'https://github.com/bitsocialhq/bitsocial-cli#bitsocial-community-edit-address'
        )
      }
      throw err
    }
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parseWithUnknownFlagCheck()
    const configDir = this.config.configDir

    const updates: Partial<Omit<BoardConfig, 'address'>> = {}
    if (flags['per-page'] !== undefined) updates.perPage = flags['per-page']
    if (flags.pages !== undefined) updates.pages = flags.pages
    if (flags['bump-limit'] !== undefined) updates.bumpLimit = flags['bump-limit']
    if (flags['archive-purge-seconds'] !== undefined) updates.archivePurgeSeconds = flags['archive-purge-seconds']

    let resetFields: Array<keyof Omit<BoardConfig, 'address'>> | undefined
    if (flags.reset) {
      const names = flags.reset.split(',').map((s) => s.trim())
      resetFields = []
      for (const name of names) {
        const field = RESETTABLE_FIELDS[name]
        if (!field) {
          this.error(`Unknown field "${name}" in --reset. Valid fields: ${Object.keys(RESETTABLE_FIELDS).join(', ')}`)
        }
        resetFields.push(field)
      }
    }

    if (Object.keys(updates).length === 0 && (!resetFields || resetFields.length === 0)) {
      this.error('At least one flag (--per-page, --pages, --bump-limit, --archive-purge-seconds) or --reset must be provided')
    }

    const filePath = boardConfigPath(configDir, args.address)
    let board: BoardConfig
    try {
      board = loadBoardConfig(filePath)
    } catch {
      this.error(`Board "${args.address}" not found in config`)
    }

    const updated = updateBoardConfig(board, updates, resetFields)
    saveBoardConfig(configDir, updated)

    this.log(`Updated board "${args.address}" in ${configDir}`)
  }
}
