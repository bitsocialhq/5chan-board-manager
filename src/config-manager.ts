import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { BoardConfig, GlobalConfig, ModerationReasons, MultiBoardConfig } from './types.js'

/** Return the path to global.json inside a config directory */
export function globalConfigPath(configDir: string): string {
  return join(configDir, 'global.json')
}

/** Return the path to a board config file inside the boards/ subdirectory */
export function boardConfigPath(configDir: string, address: string): string {
  return join(configDir, 'boards', `${address}.json`)
}

/**
 * Load a full MultiBoardConfig by reading global.json + boards/*.json.
 * Returns a default config with empty boards when directories/files are missing.
 * Throws on invalid JSON or validation errors.
 */
export function loadConfig(configDir: string): MultiBoardConfig {
  const global = loadGlobalConfig(configDir)
  const boards = loadAllBoardConfigs(configDir)

  return {
    ...global,
    boards,
  }
}

/**
 * Load global.json from a config directory.
 * Returns {} on ENOENT. Throws on invalid JSON or validation errors.
 */
export function loadGlobalConfig(configDir: string): GlobalConfig {
  const filePath = globalConfigPath(configDir)
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }
    throw new Error(`Failed to read global config "${filePath}": ${(err as Error).message}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`Invalid JSON in global config "${filePath}": ${(err as Error).message}`)
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Global config "${filePath}" must contain a JSON object`)
  }

  const config = parsed as Record<string, unknown>

  if (config.rpcUrl !== undefined && typeof config.rpcUrl !== 'string') {
    throw new Error(`Global config "${filePath}": "rpcUrl" must be a string`)
  }

  if (config.stateDir !== undefined && typeof config.stateDir !== 'string') {
    throw new Error(`Global config "${filePath}": "stateDir" must be a string`)
  }

  if (config.defaults !== undefined) {
    if (typeof config.defaults !== 'object' || config.defaults === null || Array.isArray(config.defaults)) {
      throw new Error(`Global config "${filePath}": "defaults" must be an object`)
    }
    validateNumericFields(config.defaults as Record<string, unknown>, 'defaults', filePath)
    validateModerationReasons(config.defaults as Record<string, unknown>, 'defaults', filePath)
  }

  return config as unknown as GlobalConfig
}

/**
 * Load a single board config file.
 * Throws on ENOENT, invalid JSON, or validation errors.
 */
export function loadBoardConfig(filePath: string): BoardConfig {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf-8')
  } catch (err) {
    throw new Error(`Failed to read board config "${filePath}": ${(err as Error).message}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`Invalid JSON in board config "${filePath}": ${(err as Error).message}`)
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Board config "${filePath}" must contain a JSON object`)
  }

  const board = parsed as Record<string, unknown>

  if (typeof board.address !== 'string' || board.address.trim() === '') {
    throw new Error(`Board config "${filePath}": address must be a non-empty string`)
  }

  validateNumericFields(board, 'board', filePath)
  validateModerationReasons(board, 'board', filePath)

  return board as unknown as BoardConfig
}

/**
 * Load all board configs from the boards/ subdirectory.
 * Returns [] if the directory doesn't exist.
 * Validates each file and checks for duplicates.
 */
function loadAllBoardConfigs(configDir: string): BoardConfig[] {
  const boardsDir = join(configDir, 'boards')
  let entries: string[]
  try {
    entries = readdirSync(boardsDir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw new Error(`Failed to read boards directory "${boardsDir}": ${(err as Error).message}`)
  }

  const jsonFiles = entries.filter((f) => f.endsWith('.json')).sort()
  const boards: BoardConfig[] = []
  const seen = new Set<string>()

  for (const file of jsonFiles) {
    const filePath = join(boardsDir, file)
    const board = loadBoardConfig(filePath)

    // Validate filename matches address
    const expectedFilename = `${board.address}.json`
    if (file !== expectedFilename) {
      throw new Error(`Board config "${filePath}": filename "${file}" does not match address "${board.address}" (expected "${expectedFilename}")`)
    }

    if (seen.has(board.address)) {
      throw new Error(`Board config "${filePath}": duplicate board address "${board.address}"`)
    }
    seen.add(board.address)
    boards.push(board)
  }

  return boards
}

/**
 * Save global config to global.json with atomic write.
 */
export function saveGlobalConfig(configDir: string, config: GlobalConfig): void {
  const filePath = globalConfigPath(configDir)
  atomicWriteJson(filePath, config)
}

/**
 * Save a board config to boards/{address}.json with atomic write.
 */
export function saveBoardConfig(configDir: string, board: BoardConfig): void {
  const filePath = boardConfigPath(configDir, board.address)
  atomicWriteJson(filePath, board)
}

/**
 * Rename a board config file when the board's address changes.
 * Loads the old config, writes a new file with the updated address, and deletes the old file.
 * Throws if the new address already has a config file.
 */
export function renameBoardConfig(configDir: string, oldAddress: string, newAddress: string): void {
  const oldPath = boardConfigPath(configDir, oldAddress)
  const newPath = boardConfigPath(configDir, newAddress)

  // Check for conflict
  try {
    readFileSync(newPath)
    throw new Error(`Board config for "${newAddress}" already exists, cannot rename from "${oldAddress}"`)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }

  // Load old config
  const oldConfig = loadBoardConfig(oldPath)

  // Write new config with updated address
  const newConfig: BoardConfig = { ...oldConfig, address: newAddress }
  saveBoardConfig(configDir, newConfig)

  // Delete old config file
  unlinkSync(oldPath)
}

/**
 * Delete a board config file. Throws if file not found.
 */
export function deleteBoardConfig(configDir: string, address: string): void {
  const filePath = boardConfigPath(configDir, address)
  try {
    unlinkSync(filePath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Board "${address}" not found in config`)
    }
    throw err
  }
}

/**
 * Update an existing board's config.
 * Fields in `updates` are merged onto the existing board.
 * Fields listed in `resetFields` are removed (reverts to defaults).
 * Returns the updated board config.
 */
export function updateBoardConfig(
  board: BoardConfig,
  updates: Partial<Omit<BoardConfig, 'address'>>,
  resetFields?: ReadonlyArray<keyof Omit<BoardConfig, 'address'>>,
): BoardConfig {
  if (resetFields) {
    for (const field of resetFields) {
      if (field in updates) {
        throw new Error(`Cannot set and reset the same field "${field}"`)
      }
    }
  }

  const updated: BoardConfig = { ...board, ...updates }

  if (resetFields) {
    for (const field of resetFields) {
      delete updated[field]
    }
  }

  return updated
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

function moderationReasonsChanged(a: ModerationReasons | undefined, b: ModerationReasons | undefined): boolean {
  return (
    a?.archiveCapacity !== b?.archiveCapacity ||
    a?.archiveBumpLimit !== b?.archiveBumpLimit ||
    a?.purgeArchived !== b?.purgeArchived ||
    a?.purgeDeleted !== b?.purgeDeleted
  )
}

function boardConfigChanged(a: BoardConfig, b: BoardConfig): boolean {
  return (
    a.perPage !== b.perPage ||
    a.pages !== b.pages ||
    a.bumpLimit !== b.bumpLimit ||
    a.archivePurgeSeconds !== b.archivePurgeSeconds ||
    moderationReasonsChanged(a.moderationReasons, b.moderationReasons)
  )
}

/**
 * Compute the diff between two configs for hot-reload.
 * Returns boards that were added, removed, or changed.
 */
export function diffBoards(
  oldConfig: MultiBoardConfig,
  newConfig: MultiBoardConfig,
): { added: BoardConfig[]; removed: string[]; changed: BoardConfig[] } {
  const oldAddresses = new Set(oldConfig.boards.map((b) => b.address))
  const newAddresses = new Set(newConfig.boards.map((b) => b.address))
  const oldByAddress = new Map(oldConfig.boards.map((b) => [b.address, b]))

  const added = newConfig.boards.filter((b) => !oldAddresses.has(b.address))
  const removed = oldConfig.boards
    .filter((b) => !newAddresses.has(b.address))
    .map((b) => b.address)

  const changed: BoardConfig[] = []
  for (const newBoard of newConfig.boards) {
    const oldBoard = oldByAddress.get(newBoard.address)
    if (oldBoard && boardConfigChanged(oldBoard, newBoard)) {
      changed.push(newBoard)
    }
  }

  return { added, removed, changed }
}

/** Atomic write: write to .tmp, then rename */
function atomicWriteJson(filePath: string, data: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true })
  const tmpPath = filePath + '.tmp'
  try {
    writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n')
    renameSync(tmpPath, filePath)
  } catch (err) {
    try { unlinkSync(tmpPath) } catch {}
    throw err
  }
}
