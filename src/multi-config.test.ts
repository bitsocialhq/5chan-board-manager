import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadMultiConfig, resolveBoardManagerOptions } from './multi-config.js'
import type { BoardConfig, MultiBoardConfig } from './types.js'

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'multi-config-test-'))
}

function writeConfig(dir: string, data: unknown): string {
  const path = join(dir, 'config.json')
  writeFileSync(path, JSON.stringify(data))
  return path
}

describe('loadMultiConfig', () => {
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

  it('loads a minimal valid config', () => {
    const dir = tmpDir()
    const path = writeConfig(dir, { boards: [{ address: 'board.eth' }] })
    const config = loadMultiConfig(path)
    expect(config.boards).toHaveLength(1)
    expect(config.boards[0].address).toBe('board.eth')
    expect(config.rpcUrl).toBeUndefined()
    expect(config.stateDir).toBeUndefined()
    expect(config.defaults).toBeUndefined()
  })

  it('loads a full config with all fields', () => {
    const dir = tmpDir()
    const path = writeConfig(dir, {
      rpcUrl: 'ws://custom:9138',
      stateDir: '/data/state',
      defaults: { perPage: 20, pages: 5, bumpLimit: 400, archivePurgeSeconds: 86400 },
      boards: [
        { address: 'a.eth' },
        { address: 'b.eth', bumpLimit: 600 },
      ],
    })
    const config = loadMultiConfig(path)
    expect(config.rpcUrl).toBe('ws://custom:9138')
    expect(config.stateDir).toBe('/data/state')
    expect(config.defaults?.perPage).toBe(20)
    expect(config.boards).toHaveLength(2)
    expect(config.boards[1].bumpLimit).toBe(600)
  })

  it('throws on non-existent file', () => {
    expect(() => loadMultiConfig('/no/such/file.json')).toThrow('Failed to read config file')
  })

  it('throws on invalid JSON', () => {
    const dir = tmpDir()
    const path = join(dir, 'bad.json')
    writeFileSync(path, '{ not valid json }')
    expect(() => loadMultiConfig(path)).toThrow('Invalid JSON')
  })

  it('throws when config is not an object', () => {
    const dir = tmpDir()
    const path = writeConfig(dir, [1, 2, 3])
    expect(() => loadMultiConfig(path)).toThrow('must contain a JSON object')
  })

  it('throws when boards is missing', () => {
    const dir = tmpDir()
    const path = writeConfig(dir, { rpcUrl: 'ws://x' })
    expect(() => loadMultiConfig(path)).toThrow('"boards" must be a non-empty array')
  })

  it('throws when boards is empty', () => {
    const dir = tmpDir()
    const path = writeConfig(dir, { boards: [] })
    expect(() => loadMultiConfig(path)).toThrow('"boards" must be a non-empty array')
  })

  it('throws when a board has no address', () => {
    const dir = tmpDir()
    const path = writeConfig(dir, { boards: [{ perPage: 10 }] })
    expect(() => loadMultiConfig(path)).toThrow('boards[0].address must be a non-empty string')
  })

  it('throws when a board has empty address', () => {
    const dir = tmpDir()
    const path = writeConfig(dir, { boards: [{ address: '  ' }] })
    expect(() => loadMultiConfig(path)).toThrow('boards[0].address must be a non-empty string')
  })

  it('throws on duplicate addresses', () => {
    const dir = tmpDir()
    const path = writeConfig(dir, {
      boards: [{ address: 'dup.eth' }, { address: 'dup.eth' }],
    })
    expect(() => loadMultiConfig(path)).toThrow('duplicate board address "dup.eth"')
  })

  it('throws when a numeric field is not a positive integer', () => {
    const dir = tmpDir()
    const path = writeConfig(dir, {
      boards: [{ address: 'x.eth', perPage: -1 }],
    })
    expect(() => loadMultiConfig(path)).toThrow('boards[0].perPage must be a positive integer')
  })

  it('throws when a numeric field is a float', () => {
    const dir = tmpDir()
    const path = writeConfig(dir, {
      boards: [{ address: 'x.eth', pages: 1.5 }],
    })
    expect(() => loadMultiConfig(path)).toThrow('boards[0].pages must be a positive integer')
  })

  it('throws when a numeric field is zero', () => {
    const dir = tmpDir()
    const path = writeConfig(dir, {
      boards: [{ address: 'x.eth', bumpLimit: 0 }],
    })
    expect(() => loadMultiConfig(path)).toThrow('boards[0].bumpLimit must be a positive integer')
  })

  it('throws when a numeric field is a string', () => {
    const dir = tmpDir()
    const path = writeConfig(dir, {
      boards: [{ address: 'x.eth', archivePurgeSeconds: '100' }],
    })
    expect(() => loadMultiConfig(path)).toThrow('boards[0].archivePurgeSeconds must be a positive integer')
  })

  it('throws when defaults has invalid numeric field', () => {
    const dir = tmpDir()
    const path = writeConfig(dir, {
      defaults: { perPage: -5 },
      boards: [{ address: 'x.eth' }],
    })
    expect(() => loadMultiConfig(path)).toThrow('defaults.perPage must be a positive integer')
  })

  it('throws when rpcUrl is not a string', () => {
    const dir = tmpDir()
    const path = writeConfig(dir, {
      rpcUrl: 123,
      boards: [{ address: 'x.eth' }],
    })
    expect(() => loadMultiConfig(path)).toThrow('"rpcUrl" must be a string')
  })

  it('throws when stateDir is not a string', () => {
    const dir = tmpDir()
    const path = writeConfig(dir, {
      stateDir: true,
      boards: [{ address: 'x.eth' }],
    })
    expect(() => loadMultiConfig(path)).toThrow('"stateDir" must be a string')
  })

  it('throws when defaults is not an object', () => {
    const dir = tmpDir()
    const path = writeConfig(dir, {
      defaults: 'bad',
      boards: [{ address: 'x.eth' }],
    })
    expect(() => loadMultiConfig(path)).toThrow('"defaults" must be an object')
  })

  it('loads config with moderationReasons in defaults', () => {
    const dir = tmpDir()
    const path = writeConfig(dir, {
      defaults: { moderationReasons: { archiveCapacity: 'custom' } },
      boards: [{ address: 'x.eth' }],
    })
    const config = loadMultiConfig(path)
    expect(config.defaults?.moderationReasons?.archiveCapacity).toBe('custom')
  })

  it('loads config with moderationReasons on a board', () => {
    const dir = tmpDir()
    const path = writeConfig(dir, {
      boards: [{ address: 'x.eth', moderationReasons: { purgeDeleted: 'board reason' } }],
    })
    const config = loadMultiConfig(path)
    expect(config.boards[0].moderationReasons?.purgeDeleted).toBe('board reason')
  })

  it('rejects non-object moderationReasons', () => {
    const dir = tmpDir()
    const path = writeConfig(dir, {
      boards: [{ address: 'x.eth', moderationReasons: 'bad' }],
    })
    expect(() => loadMultiConfig(path)).toThrow('boards[0].moderationReasons must be an object')
  })

  it('rejects unknown keys in moderationReasons', () => {
    const dir = tmpDir()
    const path = writeConfig(dir, {
      boards: [{ address: 'x.eth', moderationReasons: { unknownKey: 'val' } }],
    })
    expect(() => loadMultiConfig(path)).toThrow('boards[0].moderationReasons has unknown key "unknownKey"')
  })

  it('rejects non-string values in moderationReasons', () => {
    const dir = tmpDir()
    const path = writeConfig(dir, {
      boards: [{ address: 'x.eth', moderationReasons: { archiveCapacity: 123 } }],
    })
    expect(() => loadMultiConfig(path)).toThrow('boards[0].moderationReasons.archiveCapacity must be a string')
  })
})

describe('resolveBoardManagerOptions', () => {
  const envBackup = process.env.PLEBBIT_RPC_WS_URL

  afterEach(() => {
    if (envBackup === undefined) {
      delete process.env.PLEBBIT_RPC_WS_URL
    } else {
      process.env.PLEBBIT_RPC_WS_URL = envBackup
    }
  })

  it('uses config rpcUrl over env var and default', () => {
    process.env.PLEBBIT_RPC_WS_URL = 'ws://env:9138'
    const board: BoardConfig = { address: 'a.eth' }
    const config: MultiBoardConfig = {
      rpcUrl: 'ws://config:9138',
      boards: [board],
    }
    const opts = resolveBoardManagerOptions(board, config)
    expect(opts.plebbitRpcUrl).toBe('ws://config:9138')
  })

  it('falls back to env var when rpcUrl not in config', () => {
    process.env.PLEBBIT_RPC_WS_URL = 'ws://env:9138'
    const board: BoardConfig = { address: 'a.eth' }
    const config: MultiBoardConfig = { boards: [board] }
    const opts = resolveBoardManagerOptions(board, config)
    expect(opts.plebbitRpcUrl).toBe('ws://env:9138')
  })

  it('falls back to default when neither config nor env var set', () => {
    delete process.env.PLEBBIT_RPC_WS_URL
    const board: BoardConfig = { address: 'a.eth' }
    const config: MultiBoardConfig = { boards: [board] }
    const opts = resolveBoardManagerOptions(board, config)
    expect(opts.plebbitRpcUrl).toBe('ws://localhost:9138')
  })

  it('per-board values override defaults', () => {
    const board: BoardConfig = { address: 'a.eth', bumpLimit: 500, perPage: 30 }
    const config: MultiBoardConfig = {
      defaults: { bumpLimit: 300, perPage: 15, pages: 5 },
      boards: [board],
    }
    const opts = resolveBoardManagerOptions(board, config)
    expect(opts.bumpLimit).toBe(500)
    expect(opts.perPage).toBe(30)
    expect(opts.pages).toBe(5)
  })

  it('leaves unset fields as undefined so startArchiver uses its own defaults', () => {
    const board: BoardConfig = { address: 'a.eth' }
    const config: MultiBoardConfig = { boards: [board] }
    const opts = resolveBoardManagerOptions(board, config)
    expect(opts.perPage).toBeUndefined()
    expect(opts.pages).toBeUndefined()
    expect(opts.bumpLimit).toBeUndefined()
    expect(opts.archivePurgeSeconds).toBeUndefined()
    expect(opts.stateDir).toBeUndefined()
  })

  it('passes stateDir from config', () => {
    const board: BoardConfig = { address: 'a.eth' }
    const config: MultiBoardConfig = {
      stateDir: '/data/state',
      boards: [board],
    }
    const opts = resolveBoardManagerOptions(board, config)
    expect(opts.stateDir).toBe('/data/state')
  })

  it('sets subplebbitAddress from board address', () => {
    const board: BoardConfig = { address: 'my-board.eth' }
    const config: MultiBoardConfig = { boards: [board] }
    const opts = resolveBoardManagerOptions(board, config)
    expect(opts.subplebbitAddress).toBe('my-board.eth')
  })

  it('merges moderationReasons per-field: board overrides default', () => {
    const board: BoardConfig = {
      address: 'a.eth',
      moderationReasons: { archiveCapacity: 'board override' },
    }
    const config: MultiBoardConfig = {
      defaults: {
        moderationReasons: {
          archiveCapacity: 'default capacity',
          archiveBumpLimit: 'default bump',
        },
      },
      boards: [board],
    }
    const opts = resolveBoardManagerOptions(board, config)
    expect(opts.moderationReasons?.archiveCapacity).toBe('board override')
    expect(opts.moderationReasons?.archiveBumpLimit).toBe('default bump')
  })

  it('returns undefined moderationReasons when neither board nor defaults set it', () => {
    const board: BoardConfig = { address: 'a.eth' }
    const config: MultiBoardConfig = { boards: [board] }
    const opts = resolveBoardManagerOptions(board, config)
    expect(opts.moderationReasons).toBeUndefined()
  })
})
