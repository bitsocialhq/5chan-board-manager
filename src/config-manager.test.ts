import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadConfig, saveConfig, addBoard, removeBoard, updateBoard, diffBoards } from './config-manager.js'
import type { BoardConfig, MultiArchiverConfig } from './types.js'

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'config-manager-test-'))
}

function writeJson(dir: string, filename: string, data: unknown): string {
  const path = join(dir, filename)
  writeFileSync(path, JSON.stringify(data))
  return path
}

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

  it('returns default config with empty boards on ENOENT', () => {
    const config = loadConfig('/no/such/path/config.json')
    expect(config).toEqual({ boards: [] })
  })

  it('loads a minimal valid config', () => {
    const dir = tmpDir()
    const path = writeJson(dir, 'config.json', { boards: [{ address: 'board.eth' }] })
    const config = loadConfig(path)
    expect(config.boards).toHaveLength(1)
    expect(config.boards[0].address).toBe('board.eth')
  })

  it('loads a full config with all fields', () => {
    const dir = tmpDir()
    const path = writeJson(dir, 'config.json', {
      rpcUrl: 'ws://custom:9138',
      stateDir: '/data/state',
      defaults: { perPage: 20, pages: 5, bumpLimit: 400, archivePurgeSeconds: 86400 },
      boards: [
        { address: 'a.eth' },
        { address: 'b.eth', bumpLimit: 600 },
      ],
    })
    const config = loadConfig(path)
    expect(config.rpcUrl).toBe('ws://custom:9138')
    expect(config.stateDir).toBe('/data/state')
    expect(config.defaults?.perPage).toBe(20)
    expect(config.boards).toHaveLength(2)
    expect(config.boards[1].bumpLimit).toBe(600)
  })

  it('allows empty boards array', () => {
    const dir = tmpDir()
    const path = writeJson(dir, 'config.json', { boards: [] })
    const config = loadConfig(path)
    expect(config.boards).toEqual([])
  })

  it('defaults boards to empty array when missing from file', () => {
    const dir = tmpDir()
    const path = writeJson(dir, 'config.json', { rpcUrl: 'ws://x:9138' })
    const config = loadConfig(path)
    expect(config.boards).toEqual([])
  })

  it('throws on invalid JSON', () => {
    const dir = tmpDir()
    const path = join(dir, 'bad.json')
    writeFileSync(path, '{ not valid }')
    expect(() => loadConfig(path)).toThrow('Invalid JSON')
  })

  it('throws when config is not an object', () => {
    const dir = tmpDir()
    const path = writeJson(dir, 'config.json', [1, 2, 3])
    expect(() => loadConfig(path)).toThrow('must contain a JSON object')
  })

  it('throws when boards is not an array', () => {
    const dir = tmpDir()
    const path = writeJson(dir, 'config.json', { boards: 'bad' })
    expect(() => loadConfig(path)).toThrow('"boards" must be an array')
  })

  it('throws on duplicate addresses', () => {
    const dir = tmpDir()
    const path = writeJson(dir, 'config.json', {
      boards: [{ address: 'dup.eth' }, { address: 'dup.eth' }],
    })
    expect(() => loadConfig(path)).toThrow('duplicate board address "dup.eth"')
  })

  it('throws when a numeric field is not a positive integer', () => {
    const dir = tmpDir()
    const path = writeJson(dir, 'config.json', {
      boards: [{ address: 'x.eth', perPage: -1 }],
    })
    expect(() => loadConfig(path)).toThrow('boards[0].perPage must be a positive integer')
  })

  it('throws when rpcUrl is not a string', () => {
    const dir = tmpDir()
    const path = writeJson(dir, 'config.json', {
      rpcUrl: 123,
      boards: [{ address: 'x.eth' }],
    })
    expect(() => loadConfig(path)).toThrow('"rpcUrl" must be a string')
  })

  it('throws when stateDir is not a string', () => {
    const dir = tmpDir()
    const path = writeJson(dir, 'config.json', {
      stateDir: true,
      boards: [{ address: 'x.eth' }],
    })
    expect(() => loadConfig(path)).toThrow('"stateDir" must be a string')
  })

  it('throws when defaults is not an object', () => {
    const dir = tmpDir()
    const path = writeJson(dir, 'config.json', {
      defaults: 'bad',
      boards: [{ address: 'x.eth' }],
    })
    expect(() => loadConfig(path)).toThrow('"defaults" must be an object')
  })

  it('throws when board address is empty string', () => {
    const dir = tmpDir()
    const path = writeJson(dir, 'config.json', {
      boards: [{ address: '  ' }],
    })
    expect(() => loadConfig(path)).toThrow('boards[0].address must be a non-empty string')
  })
})

describe('saveConfig', () => {
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

  it('writes config as pretty-printed JSON', () => {
    const dir = tmpDir()
    const path = join(dir, 'config.json')
    const config: MultiArchiverConfig = {
      boards: [{ address: 'test.eth' }],
    }
    saveConfig(path, config)
    const written = readFileSync(path, 'utf-8')
    expect(JSON.parse(written)).toEqual(config)
    expect(written).toContain('\n')
    expect(written.endsWith('\n')).toBe(true)
  })

  it('creates parent directories', () => {
    const dir = tmpDir()
    const path = join(dir, 'nested', 'deep', 'config.json')
    saveConfig(path, { boards: [] })
    const written = readFileSync(path, 'utf-8')
    expect(JSON.parse(written)).toEqual({ boards: [] })
  })

  it('overwrites existing config', () => {
    const dir = tmpDir()
    const path = join(dir, 'config.json')
    saveConfig(path, { boards: [{ address: 'a.eth' }] })
    saveConfig(path, { boards: [{ address: 'b.eth' }] })
    const written = JSON.parse(readFileSync(path, 'utf-8'))
    expect(written.boards[0].address).toBe('b.eth')
  })
})

describe('saveConfig atomic write', () => {
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

  it('does not leave a .tmp file after successful write', () => {
    const dir = tmpDir()
    const path = join(dir, 'config.json')
    saveConfig(path, { boards: [{ address: 'a.eth' }] })
    expect(existsSync(path)).toBe(true)
    expect(existsSync(path + '.tmp')).toBe(false)
  })

  it('preserves original config when a leftover .tmp file exists', () => {
    const dir = tmpDir()
    const path = join(dir, 'config.json')
    saveConfig(path, { boards: [{ address: 'original.eth' }] })
    // Simulate a crash that left a .tmp file
    writeFileSync(path + '.tmp', 'partial garbage')
    // Original should still be readable
    const config = loadConfig(path)
    expect(config.boards[0].address).toBe('original.eth')
  })

  it('overwrites leftover .tmp on next successful save', () => {
    const dir = tmpDir()
    const path = join(dir, 'config.json')
    // Leave a stale .tmp file
    writeFileSync(path + '.tmp', 'stale')
    saveConfig(path, { boards: [{ address: 'fresh.eth' }] })
    expect(existsSync(path + '.tmp')).toBe(false)
    const config = loadConfig(path)
    expect(config.boards[0].address).toBe('fresh.eth')
  })
})

describe('addBoard', () => {
  it('adds a board to an empty config', () => {
    const config: MultiArchiverConfig = { boards: [] }
    const result = addBoard(config, { address: 'new.eth' })
    expect(result.boards).toHaveLength(1)
    expect(result.boards[0].address).toBe('new.eth')
  })

  it('adds a board with overrides', () => {
    const config: MultiArchiverConfig = { boards: [{ address: 'existing.eth' }] }
    const result = addBoard(config, { address: 'new.eth', bumpLimit: 500 })
    expect(result.boards).toHaveLength(2)
    expect(result.boards[1]).toEqual({ address: 'new.eth', bumpLimit: 500 })
  })

  it('throws on duplicate address', () => {
    const config: MultiArchiverConfig = { boards: [{ address: 'dup.eth' }] }
    expect(() => addBoard(config, { address: 'dup.eth' })).toThrow('Board "dup.eth" already exists')
  })

  it('does not mutate the original config', () => {
    const config: MultiArchiverConfig = { boards: [{ address: 'a.eth' }] }
    const result = addBoard(config, { address: 'b.eth' })
    expect(config.boards).toHaveLength(1)
    expect(result.boards).toHaveLength(2)
  })

  it('preserves existing config fields', () => {
    const config: MultiArchiverConfig = {
      rpcUrl: 'ws://test:9138',
      defaults: { perPage: 20 },
      boards: [{ address: 'a.eth' }],
    }
    const result = addBoard(config, { address: 'b.eth' })
    expect(result.rpcUrl).toBe('ws://test:9138')
    expect(result.defaults?.perPage).toBe(20)
  })
})

describe('removeBoard', () => {
  it('removes a board by address', () => {
    const config: MultiArchiverConfig = {
      boards: [{ address: 'a.eth' }, { address: 'b.eth' }],
    }
    const result = removeBoard(config, 'a.eth')
    expect(result.boards).toHaveLength(1)
    expect(result.boards[0].address).toBe('b.eth')
  })

  it('throws when board not found', () => {
    const config: MultiArchiverConfig = { boards: [{ address: 'a.eth' }] }
    expect(() => removeBoard(config, 'missing.eth')).toThrow('Board "missing.eth" not found')
  })

  it('does not mutate the original config', () => {
    const config: MultiArchiverConfig = {
      boards: [{ address: 'a.eth' }, { address: 'b.eth' }],
    }
    const result = removeBoard(config, 'a.eth')
    expect(config.boards).toHaveLength(2)
    expect(result.boards).toHaveLength(1)
  })

  it('preserves existing config fields', () => {
    const config: MultiArchiverConfig = {
      rpcUrl: 'ws://test:9138',
      boards: [{ address: 'a.eth' }],
    }
    const result = removeBoard(config, 'a.eth')
    expect(result.rpcUrl).toBe('ws://test:9138')
    expect(result.boards).toHaveLength(0)
  })
})

describe('diffBoards', () => {
  it('detects added boards', () => {
    const oldConfig: MultiArchiverConfig = { boards: [{ address: 'a.eth' }] }
    const newConfig: MultiArchiverConfig = {
      boards: [{ address: 'a.eth' }, { address: 'b.eth' }],
    }
    const diff = diffBoards(oldConfig, newConfig)
    expect(diff.added).toHaveLength(1)
    expect(diff.added[0].address).toBe('b.eth')
    expect(diff.removed).toHaveLength(0)
  })

  it('detects removed boards', () => {
    const oldConfig: MultiArchiverConfig = {
      boards: [{ address: 'a.eth' }, { address: 'b.eth' }],
    }
    const newConfig: MultiArchiverConfig = { boards: [{ address: 'a.eth' }] }
    const diff = diffBoards(oldConfig, newConfig)
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toEqual(['b.eth'])
  })

  it('detects both added and removed boards', () => {
    const oldConfig: MultiArchiverConfig = {
      boards: [{ address: 'a.eth' }, { address: 'b.eth' }],
    }
    const newConfig: MultiArchiverConfig = {
      boards: [{ address: 'a.eth' }, { address: 'c.eth' }],
    }
    const diff = diffBoards(oldConfig, newConfig)
    expect(diff.added).toHaveLength(1)
    expect(diff.added[0].address).toBe('c.eth')
    expect(diff.removed).toEqual(['b.eth'])
  })

  it('returns empty diff when configs are identical', () => {
    const config: MultiArchiverConfig = {
      boards: [{ address: 'a.eth' }, { address: 'b.eth' }],
    }
    const diff = diffBoards(config, config)
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
  })

  it('handles empty old config', () => {
    const oldConfig: MultiArchiverConfig = { boards: [] }
    const newConfig: MultiArchiverConfig = {
      boards: [{ address: 'a.eth' }],
    }
    const diff = diffBoards(oldConfig, newConfig)
    expect(diff.added).toHaveLength(1)
    expect(diff.removed).toHaveLength(0)
  })

  it('handles empty new config', () => {
    const oldConfig: MultiArchiverConfig = {
      boards: [{ address: 'a.eth' }],
    }
    const newConfig: MultiArchiverConfig = { boards: [] }
    const diff = diffBoards(oldConfig, newConfig)
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toEqual(['a.eth'])
  })

  it('preserves board config details in added boards', () => {
    const oldConfig: MultiArchiverConfig = { boards: [] }
    const newConfig: MultiArchiverConfig = {
      boards: [{ address: 'a.eth', bumpLimit: 500, perPage: 30 }],
    }
    const diff = diffBoards(oldConfig, newConfig)
    expect(diff.added[0]).toEqual({ address: 'a.eth', bumpLimit: 500, perPage: 30 })
  })

  it('detects changed boards when a field is modified', () => {
    const oldConfig: MultiArchiverConfig = {
      boards: [{ address: 'a.eth', bumpLimit: 300 }],
    }
    const newConfig: MultiArchiverConfig = {
      boards: [{ address: 'a.eth', bumpLimit: 500 }],
    }
    const diff = diffBoards(oldConfig, newConfig)
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
    expect(diff.changed).toHaveLength(1)
    expect(diff.changed[0]).toEqual({ address: 'a.eth', bumpLimit: 500 })
  })

  it('detects changed boards when a field is added', () => {
    const oldConfig: MultiArchiverConfig = {
      boards: [{ address: 'a.eth' }],
    }
    const newConfig: MultiArchiverConfig = {
      boards: [{ address: 'a.eth', perPage: 25 }],
    }
    const diff = diffBoards(oldConfig, newConfig)
    expect(diff.changed).toHaveLength(1)
    expect(diff.changed[0].perPage).toBe(25)
  })

  it('detects changed boards when a field is removed', () => {
    const oldConfig: MultiArchiverConfig = {
      boards: [{ address: 'a.eth', bumpLimit: 300 }],
    }
    const newConfig: MultiArchiverConfig = {
      boards: [{ address: 'a.eth' }],
    }
    const diff = diffBoards(oldConfig, newConfig)
    expect(diff.changed).toHaveLength(1)
    expect(diff.changed[0]).toEqual({ address: 'a.eth' })
  })

  it('returns empty changed when board configs are identical', () => {
    const config: MultiArchiverConfig = {
      boards: [{ address: 'a.eth', bumpLimit: 300 }],
    }
    const diff = diffBoards(config, { ...config, boards: [{ address: 'a.eth', bumpLimit: 300 }] })
    expect(diff.changed).toHaveLength(0)
  })

  it('separates added, removed, and changed correctly', () => {
    const oldConfig: MultiArchiverConfig = {
      boards: [{ address: 'a.eth', perPage: 10 }, { address: 'b.eth' }],
    }
    const newConfig: MultiArchiverConfig = {
      boards: [{ address: 'a.eth', perPage: 20 }, { address: 'c.eth' }],
    }
    const diff = diffBoards(oldConfig, newConfig)
    expect(diff.added).toHaveLength(1)
    expect(diff.added[0].address).toBe('c.eth')
    expect(diff.removed).toEqual(['b.eth'])
    expect(diff.changed).toHaveLength(1)
    expect(diff.changed[0]).toEqual({ address: 'a.eth', perPage: 20 })
  })
})

describe('updateBoard', () => {
  it('updates a single field on an existing board', () => {
    const config: MultiArchiverConfig = {
      boards: [{ address: 'a.eth', bumpLimit: 300 }],
    }
    const result = updateBoard(config, 'a.eth', { bumpLimit: 500 })
    expect(result.boards[0].bumpLimit).toBe(500)
  })

  it('adds a new field to an existing board', () => {
    const config: MultiArchiverConfig = {
      boards: [{ address: 'a.eth' }],
    }
    const result = updateBoard(config, 'a.eth', { perPage: 25 })
    expect(result.boards[0].perPage).toBe(25)
  })

  it('updates multiple fields at once', () => {
    const config: MultiArchiverConfig = {
      boards: [{ address: 'a.eth' }],
    }
    const result = updateBoard(config, 'a.eth', { perPage: 25, pages: 3 })
    expect(result.boards[0].perPage).toBe(25)
    expect(result.boards[0].pages).toBe(3)
  })

  it('resets a field to undefined', () => {
    const config: MultiArchiverConfig = {
      boards: [{ address: 'a.eth', bumpLimit: 500 }],
    }
    const result = updateBoard(config, 'a.eth', {}, ['bumpLimit'])
    expect(Object.hasOwn(result.boards[0], 'bumpLimit')).toBe(false)
  })

  it('resets multiple fields', () => {
    const config: MultiArchiverConfig = {
      boards: [{ address: 'a.eth', perPage: 25, pages: 3, bumpLimit: 500, archivePurgeSeconds: 86400 }],
    }
    const result = updateBoard(config, 'a.eth', {}, ['perPage', 'bumpLimit'])
    expect(Object.hasOwn(result.boards[0], 'perPage')).toBe(false)
    expect(Object.hasOwn(result.boards[0], 'bumpLimit')).toBe(false)
    expect(result.boards[0].pages).toBe(3)
    expect(result.boards[0].archivePurgeSeconds).toBe(86400)
  })

  it('allows setting one field and resetting another simultaneously', () => {
    const config: MultiArchiverConfig = {
      boards: [{ address: 'a.eth', perPage: 25, bumpLimit: 300 }],
    }
    const result = updateBoard(config, 'a.eth', { perPage: 30 }, ['bumpLimit'])
    expect(result.boards[0].perPage).toBe(30)
    expect(Object.hasOwn(result.boards[0], 'bumpLimit')).toBe(false)
  })

  it('throws when board not found', () => {
    const config: MultiArchiverConfig = { boards: [{ address: 'a.eth' }] }
    expect(() => updateBoard(config, 'missing.eth', { bumpLimit: 500 })).toThrow(
      'Board "missing.eth" not found in config',
    )
  })

  it('throws when setting and resetting the same field', () => {
    const config: MultiArchiverConfig = { boards: [{ address: 'a.eth' }] }
    expect(() => updateBoard(config, 'a.eth', { perPage: 25 }, ['perPage'])).toThrow(
      'Cannot set and reset the same field "perPage"',
    )
  })

  it('does not mutate the original config', () => {
    const config: MultiArchiverConfig = {
      boards: [{ address: 'a.eth', bumpLimit: 300 }],
    }
    const result = updateBoard(config, 'a.eth', { bumpLimit: 500 })
    expect(config.boards[0].bumpLimit).toBe(300)
    expect(result.boards[0].bumpLimit).toBe(500)
  })

  it('preserves other boards and top-level config fields', () => {
    const config: MultiArchiverConfig = {
      rpcUrl: 'ws://test:9138',
      defaults: { perPage: 20 },
      boards: [{ address: 'a.eth' }, { address: 'b.eth', bumpLimit: 300 }],
    }
    const result = updateBoard(config, 'b.eth', { bumpLimit: 500 })
    expect(result.rpcUrl).toBe('ws://test:9138')
    expect(result.defaults?.perPage).toBe(20)
    expect(result.boards[0]).toEqual({ address: 'a.eth' })
    expect(result.boards[1].bumpLimit).toBe(500)
  })

  it('preserves address field', () => {
    const config: MultiArchiverConfig = {
      boards: [{ address: 'a.eth' }],
    }
    const result = updateBoard(config, 'a.eth', { bumpLimit: 500 })
    expect(result.boards[0].address).toBe('a.eth')
  })
})
