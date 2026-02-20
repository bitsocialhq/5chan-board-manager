import { readFileSync } from 'node:fs'
import type { BoardManagerOptions, BoardConfig, ModerationReasons, MultiBoardConfig } from './types.js'

/**
 * Load and validate a multi-board JSON config file.
 * Throws with a descriptive message on any validation error.
 */
export function loadMultiConfig(configPath: string): MultiBoardConfig {
  let raw: string
  try {
    raw = readFileSync(configPath, 'utf-8')
  } catch (err) {
    throw new Error(`Failed to read config file "${configPath}": ${(err as Error).message}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`Invalid JSON in config file "${configPath}": ${(err as Error).message}`)
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Config file "${configPath}" must contain a JSON object`)
  }

  const config = parsed as Record<string, unknown>

  if (!Array.isArray(config.boards)) {
    throw new Error(`Config file "${configPath}": "boards" must be a non-empty array`)
  }

  if (config.boards.length === 0) {
    throw new Error(`Config file "${configPath}": "boards" must be a non-empty array`)
  }

  if (config.rpcUrl !== undefined && typeof config.rpcUrl !== 'string') {
    throw new Error(`Config file "${configPath}": "rpcUrl" must be a string`)
  }

  if (config.stateDir !== undefined && typeof config.stateDir !== 'string') {
    throw new Error(`Config file "${configPath}": "stateDir" must be a string`)
  }

  if (config.defaults !== undefined) {
    if (typeof config.defaults !== 'object' || config.defaults === null || Array.isArray(config.defaults)) {
      throw new Error(`Config file "${configPath}": "defaults" must be an object`)
    }
    validateNumericFields(config.defaults as Record<string, unknown>, 'defaults', configPath)
    validateModerationReasons(config.defaults as Record<string, unknown>, 'defaults', configPath)
  }

  const seen = new Set<string>()
  for (let i = 0; i < config.boards.length; i++) {
    const board = config.boards[i] as Record<string, unknown>
    if (typeof board !== 'object' || board === null || Array.isArray(board)) {
      throw new Error(`Config file "${configPath}": boards[${i}] must be an object`)
    }
    if (typeof board.address !== 'string' || board.address.trim() === '') {
      throw new Error(`Config file "${configPath}": boards[${i}].address must be a non-empty string`)
    }
    if (seen.has(board.address)) {
      throw new Error(`Config file "${configPath}": duplicate board address "${board.address}"`)
    }
    seen.add(board.address)
    validateNumericFields(board, `boards[${i}]`, configPath)
    validateModerationReasons(board, `boards[${i}]`, configPath)
  }

  return config as unknown as MultiBoardConfig
}

function validateNumericFields(obj: Record<string, unknown>, prefix: string, configPath: string): void {
  const numericKeys = ['perPage', 'pages', 'bumpLimit', 'archivePurgeSeconds'] as const
  for (const key of numericKeys) {
    if (obj[key] !== undefined) {
      if (typeof obj[key] !== 'number' || !Number.isInteger(obj[key]) || (obj[key] as number) <= 0) {
        throw new Error(`Config file "${configPath}": ${prefix}.${key} must be a positive integer`)
      }
    }
  }
}

const MODERATION_REASONS_KEYS = ['archiveCapacity', 'archiveBumpLimit', 'purgeArchived', 'purgeDeleted'] as const

function validateModerationReasons(obj: Record<string, unknown>, prefix: string, configPath: string): void {
  if (obj.moderationReasons === undefined) return
  if (typeof obj.moderationReasons !== 'object' || obj.moderationReasons === null || Array.isArray(obj.moderationReasons)) {
    throw new Error(`Config file "${configPath}": ${prefix}.moderationReasons must be an object`)
  }
  const reasons = obj.moderationReasons as Record<string, unknown>
  const allowed = new Set<string>(MODERATION_REASONS_KEYS)
  for (const key of Object.keys(reasons)) {
    if (!allowed.has(key)) {
      throw new Error(`Config file "${configPath}": ${prefix}.moderationReasons has unknown key "${key}"`)
    }
    if (typeof reasons[key] !== 'string') {
      throw new Error(`Config file "${configPath}": ${prefix}.moderationReasons.${key} must be a string`)
    }
  }
}

/**
 * Merge a board config with top-level defaults and rpcUrl/stateDir
 * to produce BoardManagerOptions for startBoardManager().
 *
 * Only sets fields that are explicitly configured — undefined fields
 * let startBoardManager's built-in DEFAULTS remain the source of truth.
 */
export function resolveBoardManagerOptions(board: BoardConfig, config: MultiBoardConfig): BoardManagerOptions {
  const rpcUrl = config.rpcUrl ?? process.env.PLEBBIT_RPC_WS_URL ?? 'ws://localhost:9138'

  const boardReasons = board.moderationReasons
  const defaultReasons = config.defaults?.moderationReasons
  let moderationReasons: ModerationReasons | undefined
  if (boardReasons || defaultReasons) {
    moderationReasons = {
      archiveCapacity: boardReasons?.archiveCapacity ?? defaultReasons?.archiveCapacity,
      archiveBumpLimit: boardReasons?.archiveBumpLimit ?? defaultReasons?.archiveBumpLimit,
      purgeArchived: boardReasons?.purgeArchived ?? defaultReasons?.purgeArchived,
      purgeDeleted: boardReasons?.purgeDeleted ?? defaultReasons?.purgeDeleted,
    }
  }

  return {
    subplebbitAddress: board.address,
    plebbitRpcUrl: rpcUrl,
    stateDir: config.stateDir,
    perPage: board.perPage ?? config.defaults?.perPage,
    pages: board.pages ?? config.defaults?.pages,
    bumpLimit: board.bumpLimit ?? config.defaults?.bumpLimit,
    archivePurgeSeconds: board.archivePurgeSeconds ?? config.defaults?.archivePurgeSeconds,
    moderationReasons,
  }
}
