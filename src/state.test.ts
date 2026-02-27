import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, hostname } from 'node:os'
import { loadState, saveState, defaultStateDir, isPidAlive, acquireLock } from './state.js'
import type { BoardManagerState } from './types.js'

describe('state', () => {
  let dir: string
  let statePath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'board-manager-test-'))
    statePath = join(dir, 'state.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  describe('loadState', () => {
    it('returns default state when file does not exist', () => {
      const state = loadState(statePath)
      expect(state).toEqual({ signers: {}, archivedThreads: {} })
    })

    it('loads existing state from file', () => {
      const existing: BoardManagerState = {
        signers: { 'sub1.bso': { privateKey: 'pk123' } },
        archivedThreads: { 'Qm123': { archivedTimestamp: 1000 } },
      }
      saveState(statePath, existing)
      const loaded = loadState(statePath)
      expect(loaded).toEqual(existing)
    })

    it('returns default state when file contains invalid JSON', async () => {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(statePath, 'not json')
      const state = loadState(statePath)
      expect(state).toEqual({ signers: {}, archivedThreads: {} })
    })
  })

  describe('saveState', () => {
    it('writes state as JSON', () => {
      const state: BoardManagerState = {
        signers: { 'board.bso': { privateKey: 'abc' } },
        archivedThreads: {},
      }
      saveState(statePath, state)
      const raw = readFileSync(statePath, 'utf-8')
      expect(JSON.parse(raw)).toEqual(state)
    })

    it('overwrites previous state', () => {
      const state1: BoardManagerState = {
        signers: {},
        archivedThreads: { 'Qm1': { archivedTimestamp: 100 } },
      }
      saveState(statePath, state1)

      const state2: BoardManagerState = {
        signers: {},
        archivedThreads: { 'Qm2': { archivedTimestamp: 200 } },
      }
      saveState(statePath, state2)

      const loaded = loadState(statePath)
      expect(loaded).toEqual(state2)
      expect(loaded.archivedThreads['Qm1']).toBeUndefined()
    })

    it('preserves both signers and archivedThreads', () => {
      const state: BoardManagerState = {
        signers: {
          'sub1.bso': { privateKey: 'key1' },
          'sub2.bso': { privateKey: 'key2' },
        },
        archivedThreads: {
          'QmA': { archivedTimestamp: 1000 },
          'QmB': { archivedTimestamp: 2000 },
        },
      }
      saveState(statePath, state)
      const loaded = loadState(statePath)
      expect(loaded.signers).toEqual(state.signers)
      expect(loaded.archivedThreads).toEqual(state.archivedThreads)
    })

    it('auto-creates missing parent directories', () => {
      const nestedPath = join(dir, 'a', 'b', 'c', 'state.json')
      const state: BoardManagerState = { signers: {}, archivedThreads: {} }
      saveState(nestedPath, state)

      expect(existsSync(nestedPath)).toBe(true)
      const loaded = loadState(nestedPath)
      expect(loaded).toEqual(state)
    })
  })

  describe('saveState atomic write', () => {
    it('does not leave a .tmp file after successful write', () => {
      const state: BoardManagerState = { signers: {}, archivedThreads: {} }
      saveState(statePath, state)
      expect(existsSync(statePath + '.tmp')).toBe(false)
      expect(existsSync(statePath)).toBe(true)
    })

    it('preserves original state when a leftover .tmp file exists', () => {
      const state: BoardManagerState = {
        signers: { 'x.bso': { privateKey: 'original' } },
        archivedThreads: {},
      }
      saveState(statePath, state)

      // Simulate a leftover .tmp from a crashed write
      writeFileSync(statePath + '.tmp', 'garbage')

      const loaded = loadState(statePath)
      expect(loaded.signers['x.bso'].privateKey).toBe('original')
    })

    it('overwrites leftover .tmp on next successful save', () => {
      writeFileSync(statePath + '.tmp', 'garbage')

      const state: BoardManagerState = { signers: {}, archivedThreads: {} }
      saveState(statePath, state)

      expect(existsSync(statePath + '.tmp')).toBe(false)
      expect(loadState(statePath)).toEqual(state)
    })
  })

  describe('isPidAlive', () => {
    it('returns true for current process', () => {
      expect(isPidAlive(process.pid)).toBe(true)
    })

    it('returns false for dead PID', () => {
      expect(isPidAlive(999999)).toBe(false)
    })
  })

  describe('acquireLock', () => {
    it('creates .lock file with current PID and hostname', () => {
      const lock = acquireLock(statePath)
      expect(existsSync(statePath + '.lock')).toBe(true)
      const content = readFileSync(statePath + '.lock', 'utf-8').trim()
      const [pidStr, host] = content.split('\n')
      expect(Number(pidStr)).toBe(process.pid)
      expect(host).toBe(hostname())
      lock.release()
    })

    it('throws when live process holds lock', () => {
      const lock = acquireLock(statePath)
      expect(() => acquireLock(statePath)).toThrow(
        `Another board manager (PID ${process.pid}) is already running`
      )
      lock.release()
    })

    it('recovers stale lock from dead PID', () => {
      writeFileSync(statePath + '.lock', `999999\n${hostname()}`)
      const lock = acquireLock(statePath)
      const content = readFileSync(statePath + '.lock', 'utf-8').trim()
      const [pidStr] = content.split('\n')
      expect(Number(pidStr)).toBe(process.pid)
      lock.release()
    })

    it('recovers stale lock from different hostname even if PID is alive', () => {
      // Use current PID (alive) but a different hostname to simulate Docker restart
      writeFileSync(statePath + '.lock', `${process.pid}\nold-container-id`)
      const lock = acquireLock(statePath)
      const content = readFileSync(statePath + '.lock', 'utf-8').trim()
      const [pidStr, host] = content.split('\n')
      expect(Number(pidStr)).toBe(process.pid)
      expect(host).toBe(hostname())
      lock.release()
    })

    it('recovers old-format lock file (PID only, no hostname) with dead PID', () => {
      writeFileSync(statePath + '.lock', '999999')
      const lock = acquireLock(statePath)
      const content = readFileSync(statePath + '.lock', 'utf-8').trim()
      const [pidStr] = content.split('\n')
      expect(Number(pidStr)).toBe(process.pid)
      lock.release()
    })

    it('release() removes .lock file', () => {
      const lock = acquireLock(statePath)
      expect(existsSync(statePath + '.lock')).toBe(true)
      lock.release()
      expect(existsSync(statePath + '.lock')).toBe(false)
    })

    it('can re-acquire after release', () => {
      const lock1 = acquireLock(statePath)
      lock1.release()
      const lock2 = acquireLock(statePath)
      expect(existsSync(statePath + '.lock')).toBe(true)
      lock2.release()
    })

    it('auto-creates parent directories', () => {
      const nestedPath = join(dir, 'a', 'b', 'c', 'state.json')
      const lock = acquireLock(nestedPath)
      expect(existsSync(nestedPath + '.lock')).toBe(true)
      lock.release()
    })
  })

  describe('defaultStateDir', () => {
    it('returns a directory path under 5chan-board-manager data dir', () => {
      const dir = defaultStateDir()
      expect(dir).toMatch(/5chan-board-manager/)
      expect(dir).toMatch(/5chan_board_manager_states$/)
    })
  })
})
