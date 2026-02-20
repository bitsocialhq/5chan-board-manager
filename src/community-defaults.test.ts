import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('./plebbit-rpc.js', () => ({
  connectToPlebbitRpc: vi.fn(),
}))

import { connectToPlebbitRpc } from './plebbit-rpc.js'
import {
  applyCommunityDefaultsToBoard,
  buildCommunityDefaultsPatch,
  buildMissingObjectPatch,
  loadCommunityDefaultsPreset,
  setParseSubplebbitEditOptionsOverrideForTests,
} from './community-defaults.js'
import type { PlebbitInstance, Subplebbit } from './types.js'

const mockConnect = vi.mocked(connectToPlebbitRpc)

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'community-defaults-test-'))
}

function createMockSubplebbit(overrides: Partial<Pick<Subplebbit, 'features' | 'settings'>> = {}): Subplebbit {
  const edit = vi.fn<Subplebbit['edit']>().mockResolvedValue(undefined)
  return {
    features: {},
    settings: {},
    edit,
    ...overrides,
  } as unknown as Subplebbit
}

function createMockPlebbitInstance(subplebbit: Subplebbit): PlebbitInstance {
  return {
    getSubplebbit: vi.fn<PlebbitInstance['getSubplebbit']>().mockResolvedValue(subplebbit),
    destroy: vi.fn<PlebbitInstance['destroy']>().mockResolvedValue(undefined),
  } as unknown as PlebbitInstance
}

describe('community defaults preset loading', () => {
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
    setParseSubplebbitEditOptionsOverrideForTests(undefined)
  })

  beforeEach(() => {
    setParseSubplebbitEditOptionsOverrideForTests((editOptions) => {
      const pseudonymityMode = (editOptions as { features?: { pseudonymityMode?: unknown } })
        .features?.pseudonymityMode
      if (
        pseudonymityMode !== undefined &&
        pseudonymityMode !== 'per-post' &&
        pseudonymityMode !== 'per-author'
      ) {
        throw new Error('Invalid value for features.pseudonymityMode')
      }
      return editOptions
    })
  })

  it('loads a valid preset json file', async () => {
    const dir = tmpDir()
    const presetPath = join(dir, 'preset.json')
    writeFileSync(presetPath, JSON.stringify({
      boardSettings: {
        features: { noUpvotes: true },
      },
      boardManagerSettings: {
        perPage: 15,
      },
    }))

    const preset = await loadCommunityDefaultsPreset(presetPath)
    expect(preset.boardSettings.features?.noUpvotes).toBe(true)
    expect(preset.boardManagerSettings.perPage).toBe(15)
  })

  it('throws when preset json is invalid', async () => {
    const dir = tmpDir()
    const presetPath = join(dir, 'bad.json')
    writeFileSync(presetPath, '{bad json')

    await expect(loadCommunityDefaultsPreset(presetPath)).rejects.toThrow('Invalid JSON')
  })

  it('throws when preset has invalid pseudonymity mode', async () => {
    const dir = tmpDir()
    const presetPath = join(dir, 'bad-shape.json')
    writeFileSync(presetPath, JSON.stringify({
      boardSettings: {
        features: { pseudonymityMode: 'wrong' },
      },
      boardManagerSettings: {},
    }))

    await expect(loadCommunityDefaultsPreset(presetPath)).rejects.toThrow('pseudonymityMode')
  })

  it('throws when preset has unsupported top-level keys', async () => {
    const dir = tmpDir()
    const presetPath = join(dir, 'bad-key.json')
    writeFileSync(presetPath, JSON.stringify({
      boardSettings: {},
      boardManagerSettings: {},
      title: 'x',
    }))

    await expect(loadCommunityDefaultsPreset(presetPath)).rejects.toThrow('Unrecognized key: "title"')
  })

  it('loads preset with moderationReasons in boardManagerSettings', async () => {
    const dir = tmpDir()
    const presetPath = join(dir, 'preset.json')
    writeFileSync(presetPath, JSON.stringify({
      boardSettings: {},
      boardManagerSettings: {
        moderationReasons: {
          archiveCapacity: 'custom capacity',
          purgeDeleted: 'custom purge',
        },
      },
    }))

    const preset = await loadCommunityDefaultsPreset(presetPath)
    expect(preset.boardManagerSettings.moderationReasons?.archiveCapacity).toBe('custom capacity')
    expect(preset.boardManagerSettings.moderationReasons?.purgeDeleted).toBe('custom purge')
  })
})

describe('buildMissingObjectPatch', () => {
  it('fills only missing nested values', () => {
    const patch = buildMissingObjectPatch(
      {
        noImages: false,
        nested: { keep: 1 },
      },
      {
        noImages: true,
        noVideos: true,
        nested: { keep: 2, add: 3 },
      },
    )

    expect(patch).toEqual({
      noVideos: true,
      nested: { add: 3 },
    })
  })

  it('returns undefined when nothing is missing', () => {
    const patch = buildMissingObjectPatch(
      {
        noImages: false,
        nested: { keep: 1, add: 3 },
      },
      {
        noImages: true,
        nested: { keep: 2, add: 3 },
      },
    )

    expect(patch).toBeUndefined()
  })
})

describe('buildCommunityDefaultsPatch', () => {
  it('builds patch only for missing boardSettings values', () => {
    const subplebbit = createMockSubplebbit({
      features: { noUpvotes: false },
      settings: { challenges: [{ name: 'captcha' }] },
    })

    const { patch, changedFields } = buildCommunityDefaultsPatch(subplebbit, {
      boardSettings: {
        features: { noUpvotes: true, noDownvotes: true },
        settings: { challenges: [{ name: 'captcha-v2' }], fetchThumbnailUrls: false },
      },
      boardManagerSettings: {},
    })

    expect(changedFields).toEqual(['features', 'settings'])
    expect(patch).toEqual({
      features: { noDownvotes: true },
      settings: { fetchThumbnailUrls: false },
    })
  })
})

describe('applyCommunityDefaultsToBoard', () => {
  beforeEach(() => {
    mockConnect.mockReset()
  })

  it('applies defaults and edits subplebbit when patch is non-empty', async () => {
    const subplebbit = createMockSubplebbit({
      features: { noUpvotes: false },
      settings: {},
    })
    const instance = createMockPlebbitInstance(subplebbit)
    mockConnect.mockResolvedValue(instance)

    const result = await applyCommunityDefaultsToBoard('board.eth', 'ws://localhost:9138', {
      boardSettings: {
        features: { noUpvotes: true, noDownvotes: true },
        settings: { fetchThumbnailUrls: false },
      },
      boardManagerSettings: {},
    })

    expect(result.applied).toBe(true)
    expect(result.changedFields).toEqual(['features', 'settings'])
    expect(subplebbit.edit).toHaveBeenCalledWith({
      features: { noDownvotes: true },
      settings: { fetchThumbnailUrls: false },
    })
    expect(instance.destroy).toHaveBeenCalledOnce()
  })

  it('returns no-op when all defaults already exist', async () => {
    const subplebbit = createMockSubplebbit({
      features: { noUpvotes: false, noDownvotes: true },
      settings: { fetchThumbnailUrls: false },
    })
    const instance = createMockPlebbitInstance(subplebbit)
    mockConnect.mockResolvedValue(instance)

    const result = await applyCommunityDefaultsToBoard('board.eth', 'ws://localhost:9138', {
      boardSettings: {
        features: { noUpvotes: true, noDownvotes: true },
        settings: { fetchThumbnailUrls: false },
      },
      boardManagerSettings: {},
    })

    expect(result).toEqual({ applied: false, changedFields: [] })
    expect(subplebbit.edit).not.toHaveBeenCalled()
    expect(instance.destroy).toHaveBeenCalledOnce()
  })

  it('destroys plebbit instance even when subplebbit lookup fails', async () => {
    const destroy = vi.fn<PlebbitInstance['destroy']>().mockResolvedValue(undefined)
    const getSubplebbit = vi.fn<PlebbitInstance['getSubplebbit']>().mockRejectedValue(new Error('lookup failed'))
    const instance = { getSubplebbit, destroy } as unknown as PlebbitInstance
    mockConnect.mockResolvedValue(instance)

    await expect(applyCommunityDefaultsToBoard('board.eth', 'ws://localhost:9138', {
      boardSettings: {},
      boardManagerSettings: {},
    })).rejects.toThrow('lookup failed')
    expect(destroy).toHaveBeenCalledOnce()
  })
})
