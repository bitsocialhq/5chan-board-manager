import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadState, saveState } from './state.js'
import type { ArchiverState } from './types.js'

// Helper to create a mock thread
function mockThread(cid: string, overrides: Record<string, any> = {}) {
  return { cid, pinned: false, locked: false, replyCount: 0, ...overrides }
}

// Helper to create a mock plebbit instance
function createMockPlebbit(dataPath: string) {
  const mockSigner = { address: 'mock-address-123', privateKey: 'mock-pk-123' }
  const publishedModerations: any[] = []

  return {
    instance: {
      dataPath,
      createSigner: vi.fn().mockResolvedValue({ ...mockSigner }),
      getSubplebbit: vi.fn(),
      createCommentModeration: vi.fn().mockImplementation((opts: any) => ({
        ...opts,
        publish: vi.fn().mockImplementation(async () => {
          publishedModerations.push(opts)
        }),
      })),
    },
    mockSigner,
    publishedModerations,
  }
}

describe('archiver logic', () => {
  let dir: string
  let statePath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'archiver-test-'))
    statePath = join(dir, '5chan-archiver-state.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  describe('state-based thread tracking', () => {
    it('records lockTimestamp when adding a locked thread', () => {
      const state: ArchiverState = { signers: {}, lockedThreads: {} }
      const now = Math.floor(Date.now() / 1000)
      state.lockedThreads['QmTest'] = { lockTimestamp: now }
      saveState(statePath, state)

      const loaded = loadState(statePath)
      expect(loaded.lockedThreads['QmTest'].lockTimestamp).toBe(now)
    })

    it('removes thread from state on purge', () => {
      const state: ArchiverState = {
        signers: {},
        lockedThreads: {
          'QmKeep': { lockTimestamp: 1000 },
          'QmPurge': { lockTimestamp: 500 },
        },
      }
      delete state.lockedThreads['QmPurge']
      saveState(statePath, state)

      const loaded = loadState(statePath)
      expect(loaded.lockedThreads['QmKeep']).toBeDefined()
      expect(loaded.lockedThreads['QmPurge']).toBeUndefined()
    })
  })

  describe('thread filtering', () => {
    it('filters out pinned threads', () => {
      const threads = [
        mockThread('Qm1', { pinned: true }),
        mockThread('Qm2'),
        mockThread('Qm3'),
        mockThread('Qm4', { pinned: true }),
      ]
      const nonPinned = threads.filter((t) => !t.pinned)
      expect(nonPinned).toHaveLength(2)
      expect(nonPinned.map((t) => t.cid)).toEqual(['Qm2', 'Qm3'])
    })

    it('identifies threads beyond capacity', () => {
      const perPage = 2
      const pages = 2
      const maxThreads = perPage * pages // 4

      const threads = Array.from({ length: 6 }, (_, i) => mockThread(`Qm${i}`))
      const nonPinned = threads.filter((t) => !t.pinned)
      const beyondCapacity = nonPinned.slice(maxThreads)

      expect(beyondCapacity).toHaveLength(2)
      expect(beyondCapacity.map((t) => t.cid)).toEqual(['Qm4', 'Qm5'])
    })

    it('skips already locked threads', () => {
      const threads = [
        mockThread('Qm1'),
        mockThread('Qm2'),
        mockThread('Qm3', { locked: true }),
        mockThread('Qm4'),
        mockThread('Qm5'),
      ]
      const maxThreads = 2
      const nonPinned = threads.filter((t) => !t.pinned)
      const beyondCapacity = nonPinned.slice(maxThreads)
      const toLock = beyondCapacity.filter((t) => !t.locked)

      expect(toLock).toHaveLength(2)
      expect(toLock.map((t) => t.cid)).toEqual(['Qm4', 'Qm5'])
    })
  })

  describe('bump limit detection', () => {
    it('identifies threads at or above bump limit', () => {
      const bumpLimit = 300
      const threads = [
        mockThread('Qm1', { replyCount: 100 }),
        mockThread('Qm2', { replyCount: 300 }),
        mockThread('Qm3', { replyCount: 500 }),
        mockThread('Qm4', { replyCount: 299 }),
      ]
      const atBumpLimit = threads.filter((t) => t.replyCount >= bumpLimit)
      expect(atBumpLimit.map((t) => t.cid)).toEqual(['Qm2', 'Qm3'])
    })

    it('skips locked threads when checking bump limit', () => {
      const bumpLimit = 300
      const threads = [
        mockThread('Qm1', { replyCount: 300, locked: true }),
        mockThread('Qm2', { replyCount: 400 }),
      ]
      const toLock = threads.filter((t) => t.replyCount >= bumpLimit && !t.locked)
      expect(toLock).toHaveLength(1)
      expect(toLock[0].cid).toBe('Qm2')
    })
  })

  describe('purge timing', () => {
    it('identifies threads past archive_purge_seconds', () => {
      const archivePurgeSeconds = 172800 // 48h
      const now = Math.floor(Date.now() / 1000)
      const state: ArchiverState = {
        signers: {},
        lockedThreads: {
          'QmOld': { lockTimestamp: now - 200000 }, // > 48h ago
          'QmRecent': { lockTimestamp: now - 1000 }, // < 48h ago
          'QmExact': { lockTimestamp: now - 172800 }, // exactly 48h ago
        },
      }

      const toPurge = Object.entries(state.lockedThreads)
        .filter(([_, info]) => now - info.lockTimestamp > archivePurgeSeconds)
      // "QmExact" is exactly at the boundary (not >), so only QmOld
      expect(toPurge.map(([cid]) => cid)).toEqual(['QmOld'])
    })

    it('does not purge threads locked less than archive_purge_seconds ago', () => {
      const archivePurgeSeconds = 172800
      const now = Math.floor(Date.now() / 1000)
      const state: ArchiverState = {
        signers: {},
        lockedThreads: {
          'Qm1': { lockTimestamp: now - 100 },
          'Qm2': { lockTimestamp: now },
        },
      }

      const toPurge = Object.entries(state.lockedThreads)
        .filter(([_, info]) => now - info.lockTimestamp > archivePurgeSeconds)
      expect(toPurge).toHaveLength(0)
    })
  })

  describe('signer management', () => {
    it('persists signer to state file', () => {
      const state: ArchiverState = { signers: {}, lockedThreads: {} }
      state.signers['my-board.eth'] = { privateKey: 'test-private-key' }
      saveState(statePath, state)

      const loaded = loadState(statePath)
      expect(loaded.signers['my-board.eth'].privateKey).toBe('test-private-key')
    })

    it('retrieves existing signer from state', () => {
      const state: ArchiverState = {
        signers: { 'board.eth': { privateKey: 'existing-key' } },
        lockedThreads: {},
      }
      saveState(statePath, state)

      const loaded = loadState(statePath)
      expect(loaded.signers['board.eth']).toBeDefined()
      expect(loaded.signers['board.eth'].privateKey).toBe('existing-key')
    })

    it('handles multiple signers for different subplebbits', () => {
      const state: ArchiverState = {
        signers: {
          'board1.eth': { privateKey: 'key1' },
          'board2.eth': { privateKey: 'key2' },
        },
        lockedThreads: {},
      }
      saveState(statePath, state)

      const loaded = loadState(statePath)
      expect(Object.keys(loaded.signers)).toHaveLength(2)
      expect(loaded.signers['board1.eth'].privateKey).toBe('key1')
      expect(loaded.signers['board2.eth'].privateKey).toBe('key2')
    })
  })

  describe('idempotency', () => {
    it('skips threads already tracked in lockedThreads state', () => {
      const state: ArchiverState = {
        signers: {},
        lockedThreads: { 'QmAlready': { lockTimestamp: 1000 } },
      }
      const threads = [mockThread('QmAlready'), mockThread('QmNew')]
      const maxThreads = 0 // all beyond capacity

      const nonPinned = threads.filter((t) => !t.pinned)
      const beyondCapacity = nonPinned.slice(maxThreads)
      const toLock = beyondCapacity.filter((t) => !t.locked && !state.lockedThreads[t.cid])

      expect(toLock).toHaveLength(1)
      expect(toLock[0].cid).toBe('QmNew')
    })
  })

  describe('cold start', () => {
    it('handles many threads needing lock at once', () => {
      const perPage = 2
      const pages = 1
      const maxThreads = perPage * pages // 2

      // Simulate 50 threads on a board that's been running without archiver
      const threads = Array.from({ length: 50 }, (_, i) => mockThread(`Qm${i}`))
      const nonPinned = threads.filter((t) => !t.pinned)
      const beyondCapacity = nonPinned.slice(maxThreads)
      const toLock = beyondCapacity.filter((t) => !t.locked)

      expect(toLock).toHaveLength(48)
    })
  })

  describe('createCommentModeration mock', () => {
    it('creates lock moderation with correct shape', async () => {
      const { instance } = createMockPlebbit(dir)
      const mod = await instance.createCommentModeration({
        commentCid: 'QmTest',
        commentModeration: { locked: true },
        subplebbitAddress: 'board.eth',
        signer: { address: 'addr', privateKey: 'pk' },
      })
      expect(instance.createCommentModeration).toHaveBeenCalledWith({
        commentCid: 'QmTest',
        commentModeration: { locked: true },
        subplebbitAddress: 'board.eth',
        signer: { address: 'addr', privateKey: 'pk' },
      })
      expect(mod.publish).toBeDefined()
    })

    it('creates purge moderation with correct shape', async () => {
      const { instance } = createMockPlebbit(dir)
      const mod = await instance.createCommentModeration({
        commentCid: 'QmTest',
        commentModeration: { purged: true },
        subplebbitAddress: 'board.eth',
        signer: { address: 'addr', privateKey: 'pk' },
      })
      expect(mod.commentModeration.purged).toBe(true)
    })

    it('tracks published moderations', async () => {
      const { instance, publishedModerations } = createMockPlebbit(dir)
      const mod = await instance.createCommentModeration({
        commentCid: 'QmTest',
        commentModeration: { locked: true },
        subplebbitAddress: 'board.eth',
        signer: { address: 'addr', privateKey: 'pk' },
      })
      await mod.publish()
      expect(publishedModerations).toHaveLength(1)
      expect(publishedModerations[0].commentCid).toBe('QmTest')
    })
  })
})
