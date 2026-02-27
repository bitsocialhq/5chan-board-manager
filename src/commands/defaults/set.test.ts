import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadGlobalConfig, saveGlobalConfig } from '../../config-manager.js'
import DefaultsSet from './set.js'

vi.mock('../../preset-editor.js', () => ({
  openInEditor: vi.fn(),
}))

import { openInEditor } from '../../preset-editor.js'

const mockOpenInEditor = vi.mocked(openInEditor)

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'defaults-set-test-'))
}

async function runCommand(args: string[], configDir: string): Promise<{ stdout: string; stderr: string }> {
  let stdout = ''
  let stderr = ''

  const cmd = new DefaultsSet(args, {} as never)
  Object.defineProperty(cmd, 'config', {
    value: {
      configDir,
      runHook: async () => ({ successes: [], failures: [] }),
    },
  })
  cmd.log = (...logArgs: string[]) => {
    stdout += logArgs.join(' ') + '\n'
  }
  cmd.warn = ((...warnArgs: [string | Error]) => {
    stderr += String(warnArgs[0]) + '\n'
  }) as typeof cmd.warn

  await cmd.run()

  return { stdout, stderr }
}

describe('defaults set command', () => {
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
    vi.restoreAllMocks()
  })

  it('sets a single default field via flag', async () => {
    const dir = tmpDir()

    await runCommand(['--per-page', '20'], dir)

    const config = loadGlobalConfig(dir)
    expect(config.defaults?.perPage).toBe(20)
  })

  it('sets multiple fields simultaneously', async () => {
    const dir = tmpDir()

    await runCommand(['--per-page', '20', '--bump-limit', '500', '--pages', '5'], dir)

    const config = loadGlobalConfig(dir)
    expect(config.defaults?.perPage).toBe(20)
    expect(config.defaults?.bumpLimit).toBe(500)
    expect(config.defaults?.pages).toBe(5)
  })

  it('resets a field (removes it from defaults)', async () => {
    const dir = tmpDir()
    saveGlobalConfig(dir, { defaults: { perPage: 20, bumpLimit: 300 } })

    await runCommand(['--reset', 'per-page'], dir)

    const config = loadGlobalConfig(dir)
    expect(config.defaults).not.toHaveProperty('perPage')
    expect(config.defaults?.bumpLimit).toBe(300)
  })

  it('sets and resets different fields simultaneously', async () => {
    const dir = tmpDir()
    saveGlobalConfig(dir, { defaults: { perPage: 20, bumpLimit: 300 } })

    await runCommand(['--pages', '5', '--reset', 'bump-limit'], dir)

    const config = loadGlobalConfig(dir)
    expect(config.defaults?.pages).toBe(5)
    expect(config.defaults?.perPage).toBe(20)
    expect(config.defaults).not.toHaveProperty('bumpLimit')
  })

  it('errors when no flags provided', async () => {
    const dir = tmpDir()

    await expect(runCommand([], dir)).rejects.toThrow('At least one flag')
  })

  it('errors on unknown reset field name', async () => {
    const dir = tmpDir()

    await expect(runCommand(['--reset', 'invalid-field'], dir)).rejects.toThrow('Unknown field')
  })

  it('errors when setting and resetting same field', async () => {
    const dir = tmpDir()

    await expect(
      runCommand(['--per-page', '20', '--reset', 'per-page'], dir),
    ).rejects.toThrow('Cannot set and reset')
  })

  it('works when global.json does not exist yet (creates it)', async () => {
    const dir = tmpDir()

    await runCommand(['--bump-limit', '400'], dir)

    const config = loadGlobalConfig(dir)
    expect(config.defaults?.bumpLimit).toBe(400)
  })

  it('preserves existing rpcUrl and userAgent when updating defaults', async () => {
    const dir = tmpDir()
    saveGlobalConfig(dir, { rpcUrl: 'ws://custom:9138', userAgent: 'my-agent', defaults: { perPage: 10 } })

    await runCommand(['--bump-limit', '500'], dir)

    const config = loadGlobalConfig(dir)
    expect(config.rpcUrl).toBe('ws://custom:9138')
    expect(config.userAgent).toBe('my-agent')
    expect(config.defaults?.perPage).toBe(10)
    expect(config.defaults?.bumpLimit).toBe(500)
  })

  it('prints confirmation message', async () => {
    const dir = tmpDir()

    const { stdout } = await runCommand(['--per-page', '20'], dir)
    expect(stdout).toContain('Updated defaults in')
  })
})

describe('defaults set --interactive', () => {
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
    vi.restoreAllMocks()
  })

  it('saves valid edits', async () => {
    const dir = tmpDir()
    saveGlobalConfig(dir, { defaults: { perPage: 10 } })

    mockOpenInEditor.mockResolvedValueOnce(JSON.stringify({ perPage: 20, bumpLimit: 500 }, null, 2) + '\n')

    await runCommand(['--interactive'], dir)

    const config = loadGlobalConfig(dir)
    expect(config.defaults?.perPage).toBe(20)
    expect(config.defaults?.bumpLimit).toBe(500)
  })

  it('rejects invalid JSON', async () => {
    const dir = tmpDir()

    mockOpenInEditor.mockResolvedValueOnce('{bad json}')

    await expect(runCommand(['--interactive'], dir)).rejects.toThrow('Invalid JSON')
  })

  it('rejects unknown fields (strict schema)', async () => {
    const dir = tmpDir()

    mockOpenInEditor.mockResolvedValueOnce(JSON.stringify({ foo: 1 }))

    await expect(runCommand(['--interactive'], dir)).rejects.toThrow('Invalid config')
  })

  it('rejects invalid values (e.g. negative numbers)', async () => {
    const dir = tmpDir()

    mockOpenInEditor.mockResolvedValueOnce(JSON.stringify({ perPage: -1 }))

    await expect(runCommand(['--interactive'], dir)).rejects.toThrow('Invalid config')
  })

  it('allows removing optional fields (empty object)', async () => {
    const dir = tmpDir()
    saveGlobalConfig(dir, { defaults: { perPage: 20, bumpLimit: 300 } })

    mockOpenInEditor.mockResolvedValueOnce(JSON.stringify({}, null, 2) + '\n')

    await runCommand(['--interactive'], dir)

    const config = loadGlobalConfig(dir)
    expect(config.defaults).toEqual({})
  })

  it('preserves existing rpcUrl and userAgent', async () => {
    const dir = tmpDir()
    saveGlobalConfig(dir, { rpcUrl: 'ws://custom:9138', userAgent: 'my-agent', defaults: { perPage: 10 } })

    mockOpenInEditor.mockResolvedValueOnce(JSON.stringify({ bumpLimit: 500 }, null, 2) + '\n')

    await runCommand(['--interactive'], dir)

    const config = loadGlobalConfig(dir)
    expect(config.rpcUrl).toBe('ws://custom:9138')
    expect(config.userAgent).toBe('my-agent')
    expect(config.defaults?.bumpLimit).toBe(500)
  })

  it('is mutually exclusive with setting flags', async () => {
    const dir = tmpDir()

    await expect(
      runCommand(['--interactive', '--bump-limit', '500'], dir),
    ).rejects.toThrow()
  })
})
