import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadConfig } from '../../config-manager.js'
import BoardRemove from './remove.js'

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'board-remove-test-'))
}

async function runCommand(args: string[], configDir: string): Promise<{ stdout: string }> {
  let stdout = ''

  const cmd = new BoardRemove(args, {} as never)
  Object.defineProperty(cmd, 'config', {
    value: {
      configDir,
      runHook: async () => ({ successes: [], failures: [] }),
    },
  })
  cmd.log = (...logArgs: string[]) => {
    stdout += logArgs.join(' ') + '\n'
  }

  await cmd.run()

  return { stdout }
}

describe('board remove command', () => {
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

  it('removes a board from the config', async () => {
    const dir = tmpDir()
    const configPath = join(dir, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      boards: [{ address: 'a.eth' }, { address: 'b.eth' }],
    }))

    await runCommand(['a.eth'], dir)

    const config = loadConfig(configPath)
    expect(config.boards).toHaveLength(1)
    expect(config.boards[0].address).toBe('b.eth')
  })

  it('throws when board not found', async () => {
    const dir = tmpDir()
    const configPath = join(dir, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      boards: [{ address: 'a.eth' }],
    }))

    await expect(runCommand(['missing.eth'], dir)).rejects.toThrow('not found')
  })

  it('prints confirmation message', async () => {
    const dir = tmpDir()
    const configPath = join(dir, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      boards: [{ address: 'board.eth' }],
    }))

    const { stdout } = await runCommand(['board.eth'], dir)
    expect(stdout).toContain('Removed board "board.eth"')
  })

  it('preserves other config fields', async () => {
    const dir = tmpDir()
    const configPath = join(dir, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      rpcUrl: 'ws://test:9138',
      boards: [{ address: 'a.eth' }],
    }))

    await runCommand(['a.eth'], dir)

    const config = loadConfig(configPath)
    expect(config.rpcUrl).toBe('ws://test:9138')
    expect(config.boards).toHaveLength(0)
  })
})
