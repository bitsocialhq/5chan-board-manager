import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadConfig } from '../../config-manager.js'
import BoardEdit from './edit.js'

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'board-edit-test-'))
}

async function runCommand(args: string[], configDir: string): Promise<{ stdout: string; stderr: string }> {
  let stdout = ''
  let stderr = ''

  const cmd = new BoardEdit(args, {} as never)
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

describe('board edit command', () => {
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

  it('updates a field on an existing board', async () => {
    const dir = tmpDir()
    const configPath = join(dir, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      boards: [{ address: 'a.eth', bumpLimit: 300 }],
    }))

    await runCommand(['a.eth', '--bump-limit', '500'], dir)

    const config = loadConfig(configPath)
    expect(config.boards[0].bumpLimit).toBe(500)
  })

  it('resets a field to default', async () => {
    const dir = tmpDir()
    const configPath = join(dir, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      boards: [{ address: 'a.eth', perPage: 25 }],
    }))

    await runCommand(['a.eth', '--reset', 'per-page'], dir)

    const config = loadConfig(configPath)
    expect(Object.hasOwn(config.boards[0], 'perPage')).toBe(false)
  })

  it('sets and resets different fields simultaneously', async () => {
    const dir = tmpDir()
    const configPath = join(dir, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      boards: [{ address: 'a.eth', perPage: 25, bumpLimit: 300 }],
    }))

    await runCommand(['a.eth', '--per-page', '30', '--reset', 'bump-limit'], dir)

    const config = loadConfig(configPath)
    expect(config.boards[0].perPage).toBe(30)
    expect(Object.hasOwn(config.boards[0], 'bumpLimit')).toBe(false)
  })

  it('throws when board not found', async () => {
    const dir = tmpDir()
    const configPath = join(dir, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      boards: [{ address: 'a.eth' }],
    }))

    await expect(runCommand(['missing.eth', '--bump-limit', '500'], dir)).rejects.toThrow('not found')
  })

  it('throws when no flags provided', async () => {
    const dir = tmpDir()
    const configPath = join(dir, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      boards: [{ address: 'a.eth' }],
    }))

    await expect(runCommand(['a.eth'], dir)).rejects.toThrow('At least one flag')
  })

  it('throws when --reset has invalid field name', async () => {
    const dir = tmpDir()
    const configPath = join(dir, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      boards: [{ address: 'a.eth' }],
    }))

    await expect(runCommand(['a.eth', '--reset', 'invalid-field'], dir)).rejects.toThrow('Unknown field')
  })

  it('throws when setting and resetting same field', async () => {
    const dir = tmpDir()
    const configPath = join(dir, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      boards: [{ address: 'a.eth' }],
    }))

    await expect(
      runCommand(['a.eth', '--per-page', '25', '--reset', 'per-page'], dir),
    ).rejects.toThrow('Cannot set and reset')
  })

  it('preserves other boards in config', async () => {
    const dir = tmpDir()
    const configPath = join(dir, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      boards: [{ address: 'a.eth' }, { address: 'b.eth', bumpLimit: 300 }],
    }))

    await runCommand(['b.eth', '--bump-limit', '500'], dir)

    const config = loadConfig(configPath)
    expect(config.boards).toHaveLength(2)
    expect(config.boards[0]).toEqual({ address: 'a.eth' })
    expect(config.boards[1].bumpLimit).toBe(500)
  })

  it('preserves other config fields', async () => {
    const dir = tmpDir()
    const configPath = join(dir, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      rpcUrl: 'ws://test:9138',
      defaults: { perPage: 20 },
      boards: [{ address: 'a.eth' }],
    }))

    await runCommand(['a.eth', '--bump-limit', '500'], dir)

    const config = loadConfig(configPath)
    expect(config.rpcUrl).toBe('ws://test:9138')
    expect(config.defaults?.perPage).toBe(20)
  })

  it('prints confirmation message', async () => {
    const dir = tmpDir()
    const configPath = join(dir, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      boards: [{ address: 'a.eth' }],
    }))

    const { stdout } = await runCommand(['a.eth', '--bump-limit', '500'], dir)
    expect(stdout).toContain('Updated board "a.eth"')
  })
})
