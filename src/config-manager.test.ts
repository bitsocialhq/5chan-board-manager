import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  loadConfig, loadGlobalConfig, loadBoardConfig, saveGlobalConfig,
  saveBoardConfig, deleteBoardConfig, updateBoardConfig, diffBoards,
  globalConfigPath, boardConfigPath,
} from './config-manager.js'
import type { BoardConfig, GlobalConfig, MultiBoardConfig } from './types.js'

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'config-manager-test-'))
}

function writeGlobalConfig(dir: string, config: unknown): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'global.json'), JSON.stringify(config))
}

function writeBoardConfig(dir: string, board: unknown): void {
  const boardsDir = join(dir, 'boards')
  mkdirSync(boardsDir, { recursive: true })
  const b = board as { address: string }
  writeFileSync(join(boardsDir, `${b.address}.json`), JSON.stringify(board))
}

describe('path helpers', () => {
  it('globalConfigPath returns global.json path', () => {
    expect(globalConfigPath('/foo/bar')).toBe('/foo/bar/global.json')
  })

  it('boardConfigPath returns boards/{address}.json path', () => {
    expect(boardConfigPath('/foo/bar', 'test.eth')).toBe('/foo/bar/boards/test.eth.json')
  })
})

describe('loadConfig', () => {
  const dirs: string[] = []

  function tmpDir(): string {
    const d = makeTmpDir()
    dirs.push(d)
    return d
  }

  afterEach(() => {
    for (const d of dirs) {
      rmSync(d, { recursive: true, force: true })
    }
    dirs.length = 0
  })

  it('returns default config with empty boards when directory is empty', () => {
    const dir = tmpDir()
    const config = loadConfig(dir)
    expect(config).toEqual({ boards: [] })
  })

  it('returns default config with empty boards when directory does not exist', () => {
    const config = loadConfig('/no/such/path/config-dir')
    expect(config).toEqual({ boards: [] })
  })

  it('loads global.json + single board file', () => {
    const dir = tmpDir()
    writeGlobalConfig(dir, { rpcUrl: 'ws://custom:9138' })
    writeBoardConfig(dir, { address: 'board.eth' })

    const config = loadConfig(dir)
    expect(config.rpcUrl).toBe('ws://custom:9138')
    expect(config.boards).toHaveLength(1)
    expect(config.boards[0].address).toBe('board.eth')
  })

  it('loads full config with all fields', () => {
    const dir = tmpDir()
    writeGlobalConfig(dir, {
      rpcUrl: 'ws://custom:9138',
      stateDir: '/data/state',
      defaults: { perPage: 20, pages: 5, bumpLimit: 400, archivePurgeSeconds: 86400 },
    })
    writeBoardConfig(dir, { address: 'a.eth' })
    writeBoardConfig(dir, { address: 'b.eth', bumpLimit: 600 })

    const config = loadConfig(dir)
    expect(config.rpcUrl).toBe('ws://custom:9138')
    expect(config.stateDir).toBe('/data/state')
    expect(config.defaults?.perPage).toBe(20)
    expect(config.boards).toHaveLength(2)
    expect(config.boards.find((b) => b.address === 'b.eth')?.bumpLimit).toBe(600)
  })

  it('returns empty boards when boards/ directory is missing', () => {
    const dir = tmpDir()
    writeGlobalConfig(dir, { rpcUrl: 'ws://x:9138' })
    const config = loadConfig(dir)
    expect(config.boards).toEqual([])
  })

  it('throws on invalid JSON in global.json', () => {
    const dir = tmpDir()
    writeFileSync(join(dir, 'global.json'), '{ not valid }')
    expect(() => loadConfig(dir)).toThrow('Invalid JSON')
  })

  it('throws when global.json is not an object', () => {
    const dir = tmpDir()
    writeGlobalConfig(dir, [1, 2, 3])
    expect(() => loadConfig(dir)).toThrow('must contain a JSON object')
  })

  it('throws on duplicate board addresses', () => {
    const dir = tmpDir()
    const boardsDir = join(dir, 'boards')
    mkdirSync(boardsDir, { recursive: true })
    // Write two files with same address but different filenames (impossible if filename matches)
    // Actually with filename validation this can't happen, test that filename mismatch is caught
    writeFileSync(join(boardsDir, 'wrong.json'), JSON.stringify({ address: 'board.eth' }))
    expect(() => loadConfig(dir)).toThrow('filename "wrong.json" does not match address "board.eth"')
  })

  it('throws when a numeric field is not a positive integer', () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'x.eth', perPage: -1 })
    expect(() => loadConfig(dir)).toThrow('perPage must be a positive integer')
  })

  it('throws when rpcUrl is not a string', () => {
    const dir = tmpDir()
    writeGlobalConfig(dir, { rpcUrl: 123 })
    expect(() => loadConfig(dir)).toThrow('"rpcUrl" must be a string')
  })

  it('throws when stateDir is not a string', () => {
    const dir = tmpDir()
    writeGlobalConfig(dir, { stateDir: true })
    expect(() => loadConfig(dir)).toThrow('"stateDir" must be a string')
  })

  it('throws when defaults is not an object', () => {
    const dir = tmpDir()
    writeGlobalConfig(dir, { defaults: 'bad' })
    expect(() => loadConfig(dir)).toThrow('"defaults" must be an object')
  })

  it('throws when board address is empty string', () => {
    const dir = tmpDir()
    const boardsDir = join(dir, 'boards')
    mkdirSync(boardsDir, { recursive: true })
    writeFileSync(join(boardsDir, '.json'), JSON.stringify({ address: '  ' }))
    expect(() => loadConfig(dir)).toThrow('address must be a non-empty string')
  })

  it('loads config with moderationReasons in defaults', () => {
    const dir = tmpDir()
    writeGlobalConfig(dir, { defaults: { moderationReasons: { archiveCapacity: 'custom' } } })
    writeBoardConfig(dir, { address: 'x.eth' })
    const config = loadConfig(dir)
    expect(config.defaults?.moderationReasons?.archiveCapacity).toBe('custom')
  })

  it('rejects non-object moderationReasons', () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'x.eth', moderationReasons: 42 })
    expect(() => loadConfig(dir)).toThrow('moderationReasons must be an object')
  })

  it('rejects unknown keys in moderationReasons', () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'x.eth', moderationReasons: { badKey: 'val' } })
    expect(() => loadConfig(dir)).toThrow('moderationReasons has unknown key "badKey"')
  })

  it('rejects non-string values in moderationReasons', () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'x.eth', moderationReasons: { purgeDeleted: true } })
    expect(() => loadConfig(dir)).toThrow('moderationReasons.purgeDeleted must be a string')
  })
})

describe('saveGlobalConfig', () => {
  const dirs: string[] = []

  function tmpDir(): string {
    const d = makeTmpDir()
    dirs.push(d)
    return d
  }

  afterEach(() => {
    for (const d of dirs) {
      rmSync(d, { recursive: true, force: true })
    }
    dirs.length = 0
  })

  it('writes global config as pretty-printed JSON', () => {
    const dir = tmpDir()
    const config: GlobalConfig = { rpcUrl: 'ws://test:9138' }
    saveGlobalConfig(dir, config)
    const written = readFileSync(join(dir, 'global.json'), 'utf-8')
    expect(JSON.parse(written)).toEqual(config)
    expect(written).toContain('\n')
    expect(written.endsWith('\n')).toBe(true)
  })

  it('creates parent directories', () => {
    const dir = tmpDir()
    const nested = join(dir, 'nested', 'deep')
    saveGlobalConfig(nested, { stateDir: '/test' })
    const written = readFileSync(join(nested, 'global.json'), 'utf-8')
    expect(JSON.parse(written)).toEqual({ stateDir: '/test' })
  })
})

describe('saveBoardConfig', () => {
  const dirs: string[] = []

  function tmpDir(): string {
    const d = makeTmpDir()
    dirs.push(d)
    return d
  }

  afterEach(() => {
    for (const d of dirs) {
      rmSync(d, { recursive: true, force: true })
    }
    dirs.length = 0
  })

  it('writes board config to boards/{address}.json', () => {
    const dir = tmpDir()
    const board: BoardConfig = { address: 'test.eth', bumpLimit: 500 }
    saveBoardConfig(dir, board)
    const written = readFileSync(join(dir, 'boards', 'test.eth.json'), 'utf-8')
    expect(JSON.parse(written)).toEqual(board)
    expect(written.endsWith('\n')).toBe(true)
  })

  it('creates boards/ directory if missing', () => {
    const dir = tmpDir()
    saveBoardConfig(dir, { address: 'new.eth' })
    expect(existsSync(join(dir, 'boards', 'new.eth.json'))).toBe(true)
  })

  it('overwrites existing board config', () => {
    const dir = tmpDir()
    saveBoardConfig(dir, { address: 'a.eth', bumpLimit: 300 })
    saveBoardConfig(dir, { address: 'a.eth', bumpLimit: 500 })
    const written = JSON.parse(readFileSync(join(dir, 'boards', 'a.eth.json'), 'utf-8'))
    expect(written.bumpLimit).toBe(500)
  })

  it('does not leave a .tmp file after successful write', () => {
    const dir = tmpDir()
    saveBoardConfig(dir, { address: 'a.eth' })
    const filePath = join(dir, 'boards', 'a.eth.json')
    expect(existsSync(filePath)).toBe(true)
    expect(existsSync(filePath + '.tmp')).toBe(false)
  })
})

describe('deleteBoardConfig', () => {
  const dirs: string[] = []

  function tmpDir(): string {
    const d = makeTmpDir()
    dirs.push(d)
    return d
  }

  afterEach(() => {
    for (const d of dirs) {
      rmSync(d, { recursive: true, force: true })
    }
    dirs.length = 0
  })

  it('deletes a board config file', () => {
    const dir = tmpDir()
    saveBoardConfig(dir, { address: 'a.eth' })
    expect(existsSync(join(dir, 'boards', 'a.eth.json'))).toBe(true)

    deleteBoardConfig(dir, 'a.eth')
    expect(existsSync(join(dir, 'boards', 'a.eth.json'))).toBe(false)
  })

  it('throws when board not found', () => {
    const dir = tmpDir()
    mkdirSync(join(dir, 'boards'), { recursive: true })
    expect(() => deleteBoardConfig(dir, 'missing.eth')).toThrow('Board "missing.eth" not found')
  })
})

describe('updateBoardConfig', () => {
  it('updates a single field on an existing board', () => {
    const board: BoardConfig = { address: 'a.eth', bumpLimit: 300 }
    const result = updateBoardConfig(board, { bumpLimit: 500 })
    expect(result.bumpLimit).toBe(500)
  })

  it('adds a new field to an existing board', () => {
    const board: BoardConfig = { address: 'a.eth' }
    const result = updateBoardConfig(board, { perPage: 25 })
    expect(result.perPage).toBe(25)
  })

  it('updates multiple fields at once', () => {
    const board: BoardConfig = { address: 'a.eth' }
    const result = updateBoardConfig(board, { perPage: 25, pages: 3 })
    expect(result.perPage).toBe(25)
    expect(result.pages).toBe(3)
  })

  it('resets a field to undefined', () => {
    const board: BoardConfig = { address: 'a.eth', bumpLimit: 500 }
    const result = updateBoardConfig(board, {}, ['bumpLimit'])
    expect(Object.hasOwn(result, 'bumpLimit')).toBe(false)
  })

  it('resets multiple fields', () => {
    const board: BoardConfig = { address: 'a.eth', perPage: 25, pages: 3, bumpLimit: 500, archivePurgeSeconds: 86400 }
    const result = updateBoardConfig(board, {}, ['perPage', 'bumpLimit'])
    expect(Object.hasOwn(result, 'perPage')).toBe(false)
    expect(Object.hasOwn(result, 'bumpLimit')).toBe(false)
    expect(result.pages).toBe(3)
    expect(result.archivePurgeSeconds).toBe(86400)
  })

  it('allows setting one field and resetting another simultaneously', () => {
    const board: BoardConfig = { address: 'a.eth', perPage: 25, bumpLimit: 300 }
    const result = updateBoardConfig(board, { perPage: 30 }, ['bumpLimit'])
    expect(result.perPage).toBe(30)
    expect(Object.hasOwn(result, 'bumpLimit')).toBe(false)
  })

  it('throws when setting and resetting the same field', () => {
    const board: BoardConfig = { address: 'a.eth' }
    expect(() => updateBoardConfig(board, { perPage: 25 }, ['perPage'])).toThrow(
      'Cannot set and reset the same field "perPage"',
    )
  })

  it('does not mutate the original board', () => {
    const board: BoardConfig = { address: 'a.eth', bumpLimit: 300 }
    const result = updateBoardConfig(board, { bumpLimit: 500 })
    expect(board.bumpLimit).toBe(300)
    expect(result.bumpLimit).toBe(500)
  })

  it('preserves address field', () => {
    const board: BoardConfig = { address: 'a.eth' }
    const result = updateBoardConfig(board, { bumpLimit: 500 })
    expect(result.address).toBe('a.eth')
  })

  it('updates moderationReasons on a board', () => {
    const board: BoardConfig = { address: 'a.eth' }
    const result = updateBoardConfig(board, { moderationReasons: { archiveCapacity: 'custom' } })
    expect(result.moderationReasons?.archiveCapacity).toBe('custom')
  })

  it('resets moderationReasons on a board', () => {
    const board: BoardConfig = { address: 'a.eth', moderationReasons: { archiveCapacity: 'val' } }
    const result = updateBoardConfig(board, {}, ['moderationReasons'])
    expect(Object.hasOwn(result, 'moderationReasons')).toBe(false)
  })
})

describe('diffBoards', () => {
  it('detects added boards', () => {
    const oldConfig: MultiBoardConfig = { boards: [{ address: 'a.eth' }] }
    const newConfig: MultiBoardConfig = {
      boards: [{ address: 'a.eth' }, { address: 'b.eth' }],
    }
    const diff = diffBoards(oldConfig, newConfig)
    expect(diff.added).toHaveLength(1)
    expect(diff.added[0].address).toBe('b.eth')
    expect(diff.removed).toHaveLength(0)
  })

  it('detects removed boards', () => {
    const oldConfig: MultiBoardConfig = {
      boards: [{ address: 'a.eth' }, { address: 'b.eth' }],
    }
    const newConfig: MultiBoardConfig = { boards: [{ address: 'a.eth' }] }
    const diff = diffBoards(oldConfig, newConfig)
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toEqual(['b.eth'])
  })

  it('detects both added and removed boards', () => {
    const oldConfig: MultiBoardConfig = {
      boards: [{ address: 'a.eth' }, { address: 'b.eth' }],
    }
    const newConfig: MultiBoardConfig = {
      boards: [{ address: 'a.eth' }, { address: 'c.eth' }],
    }
    const diff = diffBoards(oldConfig, newConfig)
    expect(diff.added).toHaveLength(1)
    expect(diff.added[0].address).toBe('c.eth')
    expect(diff.removed).toEqual(['b.eth'])
  })

  it('returns empty diff when configs are identical', () => {
    const config: MultiBoardConfig = {
      boards: [{ address: 'a.eth' }, { address: 'b.eth' }],
    }
    const diff = diffBoards(config, config)
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
  })

  it('handles empty old config', () => {
    const oldConfig: MultiBoardConfig = { boards: [] }
    const newConfig: MultiBoardConfig = {
      boards: [{ address: 'a.eth' }],
    }
    const diff = diffBoards(oldConfig, newConfig)
    expect(diff.added).toHaveLength(1)
    expect(diff.removed).toHaveLength(0)
  })

  it('handles empty new config', () => {
    const oldConfig: MultiBoardConfig = {
      boards: [{ address: 'a.eth' }],
    }
    const newConfig: MultiBoardConfig = { boards: [] }
    const diff = diffBoards(oldConfig, newConfig)
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toEqual(['a.eth'])
  })

  it('preserves board config details in added boards', () => {
    const oldConfig: MultiBoardConfig = { boards: [] }
    const newConfig: MultiBoardConfig = {
      boards: [{ address: 'a.eth', bumpLimit: 500, perPage: 30 }],
    }
    const diff = diffBoards(oldConfig, newConfig)
    expect(diff.added[0]).toEqual({ address: 'a.eth', bumpLimit: 500, perPage: 30 })
  })

  it('detects changed boards when a field is modified', () => {
    const oldConfig: MultiBoardConfig = {
      boards: [{ address: 'a.eth', bumpLimit: 300 }],
    }
    const newConfig: MultiBoardConfig = {
      boards: [{ address: 'a.eth', bumpLimit: 500 }],
    }
    const diff = diffBoards(oldConfig, newConfig)
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
    expect(diff.changed).toHaveLength(1)
    expect(diff.changed[0]).toEqual({ address: 'a.eth', bumpLimit: 500 })
  })

  it('detects changed boards when a field is added', () => {
    const oldConfig: MultiBoardConfig = {
      boards: [{ address: 'a.eth' }],
    }
    const newConfig: MultiBoardConfig = {
      boards: [{ address: 'a.eth', perPage: 25 }],
    }
    const diff = diffBoards(oldConfig, newConfig)
    expect(diff.changed).toHaveLength(1)
    expect(diff.changed[0].perPage).toBe(25)
  })

  it('detects changed boards when a field is removed', () => {
    const oldConfig: MultiBoardConfig = {
      boards: [{ address: 'a.eth', bumpLimit: 300 }],
    }
    const newConfig: MultiBoardConfig = {
      boards: [{ address: 'a.eth' }],
    }
    const diff = diffBoards(oldConfig, newConfig)
    expect(diff.changed).toHaveLength(1)
    expect(diff.changed[0]).toEqual({ address: 'a.eth' })
  })

  it('returns empty changed when board configs are identical', () => {
    const config: MultiBoardConfig = {
      boards: [{ address: 'a.eth', bumpLimit: 300 }],
    }
    const diff = diffBoards(config, { ...config, boards: [{ address: 'a.eth', bumpLimit: 300 }] })
    expect(diff.changed).toHaveLength(0)
  })

  it('separates added, removed, and changed correctly', () => {
    const oldConfig: MultiBoardConfig = {
      boards: [{ address: 'a.eth', perPage: 10 }, { address: 'b.eth' }],
    }
    const newConfig: MultiBoardConfig = {
      boards: [{ address: 'a.eth', perPage: 20 }, { address: 'c.eth' }],
    }
    const diff = diffBoards(oldConfig, newConfig)
    expect(diff.added).toHaveLength(1)
    expect(diff.added[0].address).toBe('c.eth')
    expect(diff.removed).toEqual(['b.eth'])
    expect(diff.changed).toHaveLength(1)
    expect(diff.changed[0]).toEqual({ address: 'a.eth', perPage: 20 })
  })

  it('detects moderationReasons changes', () => {
    const oldConfig: MultiBoardConfig = {
      boards: [{ address: 'a.eth', moderationReasons: { archiveCapacity: 'old' } }],
    }
    const newConfig: MultiBoardConfig = {
      boards: [{ address: 'a.eth', moderationReasons: { archiveCapacity: 'new' } }],
    }
    const diff = diffBoards(oldConfig, newConfig)
    expect(diff.changed).toHaveLength(1)
    expect(diff.changed[0].moderationReasons?.archiveCapacity).toBe('new')
  })

  it('no change when moderationReasons are identical', () => {
    const reasons = { archiveCapacity: 'same' }
    const config: MultiBoardConfig = {
      boards: [{ address: 'a.eth', moderationReasons: reasons }],
    }
    const diff = diffBoards(config, { ...config, boards: [{ address: 'a.eth', moderationReasons: { ...reasons } }] })
    expect(diff.changed).toHaveLength(0)
  })
})
