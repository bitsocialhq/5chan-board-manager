import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import type { BoardConfig, MultiArchiverConfig } from './types.js'

/**
 * Load a config file from disk.
 * Returns a default config with empty boards on ENOENT.
 * Throws on invalid JSON or validation errors.
 */
export function loadConfig(configPath: string): MultiArchiverConfig {
  let raw: string
  try {
    raw = readFileSync(configPath, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { boards: [] }
    }
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

  if (config.boards !== undefined && !Array.isArray(config.boards)) {
    throw new Error(`Config file "${configPath}": "boards" must be an array`)
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
  }

  const boards = (config.boards ?? []) as unknown[]
  const seen = new Set<string>()
  for (let i = 0; i < boards.length; i++) {
    const board = boards[i] as Record<string, unknown>
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
  }

  // Ensure boards key exists even if missing from file
  if (!config.boards) {
    (config as Record<string, unknown>).boards = []
  }

  return config as unknown as MultiArchiverConfig
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

/**
 * Save a config to disk with pretty-printed JSON.
 * Creates parent directories if needed.
 */
export function saveConfig(configPath: string, config: MultiArchiverConfig): void {
  mkdirSync(dirname(configPath), { recursive: true })
  const tmpPath = configPath + '.tmp'
  try {
    writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n')
    renameSync(tmpPath, configPath)
  } catch (err) {
    try { unlinkSync(tmpPath) } catch {}
    throw err
  }
}

/**
 * Add a board to the config. Throws if the address already exists.
 */
export function addBoard(config: MultiArchiverConfig, board: BoardConfig): MultiArchiverConfig {
  if (config.boards.some((b) => b.address === board.address)) {
    throw new Error(`Board "${board.address}" already exists in config`)
  }
  return {
    ...config,
    boards: [...config.boards, board],
  }
}

/**
 * Remove a board from the config by address. Throws if not found.
 */
export function removeBoard(config: MultiArchiverConfig, address: string): MultiArchiverConfig {
  const idx = config.boards.findIndex((b) => b.address === address)
  if (idx === -1) {
    throw new Error(`Board "${address}" not found in config`)
  }
  return {
    ...config,
    boards: config.boards.filter((b) => b.address !== address),
  }
}

/**
 * Update an existing board's config. Throws if not found.
 * Fields in `updates` are merged onto the existing board.
 * Fields listed in `resetFields` are removed (reverts to defaults).
 */
export function updateBoard(
  config: MultiArchiverConfig,
  address: string,
  updates: Partial<Omit<BoardConfig, 'address'>>,
  resetFields?: ReadonlyArray<keyof Omit<BoardConfig, 'address'>>,
): MultiArchiverConfig {
  const idx = config.boards.findIndex((b) => b.address === address)
  if (idx === -1) {
    throw new Error(`Board "${address}" not found in config`)
  }

  if (resetFields) {
    for (const field of resetFields) {
      if (field in updates) {
        throw new Error(`Cannot set and reset the same field "${field}"`)
      }
    }
  }

  const existing = config.boards[idx]
  const updated: BoardConfig = { ...existing, ...updates }

  if (resetFields) {
    for (const field of resetFields) {
      delete updated[field]
    }
  }

  return {
    ...config,
    boards: config.boards.map((b, i) => (i === idx ? updated : b)),
  }
}

function boardConfigChanged(a: BoardConfig, b: BoardConfig): boolean {
  return (
    a.perPage !== b.perPage ||
    a.pages !== b.pages ||
    a.bumpLimit !== b.bumpLimit ||
    a.archivePurgeSeconds !== b.archivePurgeSeconds
  )
}

/**
 * Compute the diff between two configs for hot-reload.
 * Returns boards that were added, removed, or changed.
 */
export function diffBoards(
  oldConfig: MultiArchiverConfig,
  newConfig: MultiArchiverConfig,
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
