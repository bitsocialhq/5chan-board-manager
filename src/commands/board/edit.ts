import { Args, Command, Flags } from '@oclif/core'
import { join } from 'node:path'
import { loadConfig, saveConfig, updateBoard } from '../../config-manager.js'
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
      description: 'Subplebbit address to edit',
      required: true,
    }),
  }

  static override description = 'Edit config for an existing board'

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

  async run(): Promise<void> {
    const { args, flags } = await this.parse(BoardEdit)
    const configPath = join(this.config.configDir, 'config.json')

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

    const config = loadConfig(configPath)
    const updated = updateBoard(config, args.address, updates, resetFields)
    saveConfig(configPath, updated)

    this.log(`Updated board "${args.address}" in ${configPath}`)
  }
}
