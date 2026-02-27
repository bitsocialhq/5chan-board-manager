import { Command, Flags } from '@oclif/core'
import { loadGlobalConfig, saveGlobalConfig } from '../../config-manager.js'
import { isNonExistentFlagsError } from '../../parse-utils.js'
import { openInEditor } from '../../preset-editor.js'
import { BoardManagerSettingsSchema, formatZodIssues } from '../../community-defaults.js'
import type { BoardDefaults, GlobalConfig } from '../../types.js'

/** Maps kebab-case CLI flag names to camelCase BoardDefaults field names */
const RESETTABLE_FIELDS: Record<string, keyof BoardDefaults> = {
  'per-page': 'perPage',
  'pages': 'pages',
  'bump-limit': 'bumpLimit',
  'archive-purge-seconds': 'archivePurgeSeconds',
  'moderation-reasons': 'moderationReasons',
}

export default class DefaultsSet extends Command {
  static override description = `Set global default settings for all boards

Defaults in global.json apply to every board unless overridden per-board.
Use --interactive (-i) to open the defaults object in $EDITOR for direct editing.`

  static override examples = [
    '5chan defaults set --per-page 20',
    '5chan defaults set --bump-limit 500 --pages 10',
    '5chan defaults set --reset per-page,bump-limit',
    '5chan defaults set --per-page 20 --reset bump-limit',
    '5chan defaults set --interactive',
    '5chan defaults set -i',
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
      description: 'Comma-separated fields to remove from defaults (per-page, pages, bump-limit, archive-purge-seconds, moderation-reasons)',
    }),
    interactive: Flags.boolean({
      char: 'i',
      description: 'Open defaults in $EDITOR for interactive editing',
      exclusive: ['per-page', 'pages', 'bump-limit', 'archive-purge-seconds', 'reset'],
    }),
  }

  private async parseWithUnknownFlagCheck() {
    try {
      return await this.parse(DefaultsSet)
    } catch (err) {
      if (isNonExistentFlagsError(err)) {
        this.error(
          `Unknown option${err.flags.length === 1 ? '' : 's'}: ${err.flags.join(', ')}\n\n` +
          'Valid flags: --per-page, --pages, --bump-limit, --archive-purge-seconds, --reset, --interactive'
        )
      }
      throw err
    }
  }

  async run(): Promise<void> {
    const { flags } = await this.parseWithUnknownFlagCheck()
    const configDir = this.config.configDir

    const config = loadGlobalConfig(configDir)

    if (flags.interactive) {
      await this.runInteractive(config, configDir)
      return
    }

    const updates: Partial<BoardDefaults> = {}
    if (flags['per-page'] !== undefined) updates.perPage = flags['per-page']
    if (flags.pages !== undefined) updates.pages = flags.pages
    if (flags['bump-limit'] !== undefined) updates.bumpLimit = flags['bump-limit']
    if (flags['archive-purge-seconds'] !== undefined) updates.archivePurgeSeconds = flags['archive-purge-seconds']

    let resetFields: Array<keyof BoardDefaults> | undefined
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
      this.error('At least one flag (--per-page, --pages, --bump-limit, --archive-purge-seconds, --interactive) or --reset must be provided')
    }

    if (resetFields) {
      for (const field of resetFields) {
        if (field in updates) {
          this.error(`Cannot set and reset the same field "${field}"`)
        }
      }
    }

    const defaults: BoardDefaults = { ...config.defaults, ...updates }

    if (resetFields) {
      for (const field of resetFields) {
        delete defaults[field]
      }
    }

    const updated: GlobalConfig = { ...config, defaults }
    saveGlobalConfig(configDir, updated)

    this.log(`Updated defaults in ${configDir}`)
  }

  private async runInteractive(config: GlobalConfig, configDir: string): Promise<void> {
    const json = JSON.stringify(config.defaults ?? {}, null, 2) + '\n'

    const edited = await openInEditor(json)

    let parsed: unknown
    try {
      parsed = JSON.parse(edited)
    } catch (err) {
      this.error(`Invalid JSON: ${(err as Error).message}`)
    }

    const result = BoardManagerSettingsSchema.safeParse(parsed)
    if (!result.success) {
      this.error(`Invalid config: ${formatZodIssues(result.error)}`)
    }

    const updated: GlobalConfig = { ...config, defaults: result.data }
    saveGlobalConfig(configDir, updated)

    this.log(`Updated defaults in ${configDir}`)
  }
}
