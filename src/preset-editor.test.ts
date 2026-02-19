import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { flattenPreset, formatPresetDisplay, resolveEditor, openPresetInEditor } from './preset-editor.js'
import type { FlatPresetEntry } from './preset-editor.js'
import type { CommunityDefaultsPreset } from './community-defaults.js'

const SIMPLE_PRESET: CommunityDefaultsPreset = {
  boardSettings: {
    features: {
      noUpvotes: true,
      noDownvotes: true,
    },
  },
  boardManagerSettings: {
    perPage: 15,
    pages: 10,
  },
}

const PRESET_WITH_CHALLENGES: CommunityDefaultsPreset = {
  boardSettings: {
    features: {
      noUpvotes: true,
      pseudonymityMode: 'per-post',
    },
    settings: {
      challenges: [
        { name: 'fail', description: 'Blocks excessive failures.' },
        { name: 'captcha-canvas-v3', description: 'Post captcha.' },
      ],
    },
  },
  boardManagerSettings: {
    perPage: 15,
    bumpLimit: 300,
  },
}

describe('flattenPreset', () => {
  it('flattens a simple preset into dot-path entries', () => {
    const entries = flattenPreset(SIMPLE_PRESET)

    expect(entries).toEqual([
      { dotPath: 'features.noUpvotes', value: true, section: 'boardSettings' },
      { dotPath: 'features.noDownvotes', value: true, section: 'boardSettings' },
      { dotPath: 'perPage', value: 15, section: 'boardManagerSettings' },
      { dotPath: 'pages', value: 10, section: 'boardManagerSettings' },
    ])
  })

  it('preserves arrays as leaf values without further flattening', () => {
    const entries = flattenPreset(PRESET_WITH_CHALLENGES)

    const challengesEntry = entries.find((e) => e.dotPath === 'settings.challenges')
    expect(challengesEntry).toBeDefined()
    expect(challengesEntry!.section).toBe('boardSettings')
    expect(Array.isArray(challengesEntry!.value)).toBe(true)
    expect((challengesEntry!.value as unknown[]).length).toBe(2)
  })

  it('handles empty boardSettings', () => {
    const entries = flattenPreset({
      boardSettings: {},
      boardManagerSettings: { perPage: 15 },
    })

    const boardEntries = entries.filter((e) => e.section === 'boardSettings')
    const managerEntries = entries.filter((e) => e.section === 'boardManagerSettings')

    expect(boardEntries).toHaveLength(0)
    expect(managerEntries).toHaveLength(1)
  })

  it('handles empty boardManagerSettings', () => {
    const entries = flattenPreset({
      boardSettings: { features: { noUpvotes: true } },
      boardManagerSettings: {},
    })

    const boardEntries = entries.filter((e) => e.section === 'boardSettings')
    const managerEntries = entries.filter((e) => e.section === 'boardManagerSettings')

    expect(boardEntries).toHaveLength(1)
    expect(managerEntries).toHaveLength(0)
  })

  it('skips undefined boardManagerSettings values', () => {
    const entries = flattenPreset({
      boardSettings: {},
      boardManagerSettings: { perPage: 15, pages: undefined },
    })

    expect(entries).toEqual([
      { dotPath: 'perPage', value: 15, section: 'boardManagerSettings' },
    ])
  })
})

describe('formatPresetDisplay', () => {
  it('formats display with both sections', () => {
    const entries: FlatPresetEntry[] = [
      { dotPath: 'features.noUpvotes', value: true, section: 'boardSettings' },
      { dotPath: 'features.noDownvotes', value: true, section: 'boardSettings' },
      { dotPath: 'perPage', value: 15, section: 'boardManagerSettings' },
    ]

    const output = formatPresetDisplay('board.eth', entries)

    expect(output).toContain('Preset defaults for "board.eth"')
    expect(output).toContain('Board Settings (applied to subplebbit)')
    expect(output).toContain('features.noUpvotes')
    expect(output).toContain('true')
    expect(output).toContain('Board Manager Settings (config)')
    expect(output).toContain('perPage')
    expect(output).toContain('15')
  })

  it('shows "(none)" for empty sections', () => {
    const entries: FlatPresetEntry[] = [
      { dotPath: 'perPage', value: 15, section: 'boardManagerSettings' },
    ]

    const output = formatPresetDisplay('board.eth', entries)

    expect(output).toContain('Board Settings: (none)')
    expect(output).toContain('Board Manager Settings (config)')
  })

  it('shows array summary for complex values', () => {
    const entries: FlatPresetEntry[] = [
      { dotPath: 'settings.challenges', value: [{ name: 'fail' }, { name: 'captcha' }], section: 'boardSettings' },
    ]

    const output = formatPresetDisplay('board.eth', entries)
    expect(output).toContain('[Array: 2 items]')
  })

  it('shows object summary for object values', () => {
    const entries: FlatPresetEntry[] = [
      { dotPath: 'options', value: { width: '280', height: '96' }, section: 'boardSettings' },
    ]

    const output = formatPresetDisplay('board.eth', entries)
    expect(output).toContain('{Object: width, height}')
  })

  it('shows singular "item" for single-element arrays', () => {
    const entries: FlatPresetEntry[] = [
      { dotPath: 'settings.challenges', value: [{ name: 'fail' }], section: 'boardSettings' },
    ]

    const output = formatPresetDisplay('board.eth', entries)
    expect(output).toContain('[Array: 1 item]')
  })
})

describe('resolveEditor', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('prefers $VISUAL over $EDITOR', () => {
    process.env['VISUAL'] = 'code'
    process.env['EDITOR'] = 'vim'

    expect(resolveEditor()).toBe('code')
  })

  it('falls back to $EDITOR when $VISUAL is unset', () => {
    delete process.env['VISUAL']
    process.env['EDITOR'] = 'nano'

    expect(resolveEditor()).toBe('nano')
  })

  it('falls back to vi on non-win32 when both are unset', () => {
    delete process.env['VISUAL']
    delete process.env['EDITOR']

    // On Linux (our CI/test env), should return 'vi'
    const result = resolveEditor()
    expect(['vi', 'notepad']).toContain(result)
  })
})

describe('openPresetInEditor', () => {
  const mockSpawn = vi.fn()
  let originalSpawn: typeof import('node:child_process').spawn

  beforeEach(async () => {
    const cp = await import('node:child_process')
    originalSpawn = cp.spawn
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes preset JSON to temp file and returns edited content', async () => {
    // Use 'cat' as the "editor" — it just outputs the file, leaving it unchanged
    const preset: CommunityDefaultsPreset = {
      boardSettings: { features: { noUpvotes: true } },
      boardManagerSettings: { perPage: 15 },
    }

    // Use a no-op "editor" that doesn't modify the file (true command)
    const result = await openPresetInEditor(preset, 'true')
    const parsed = JSON.parse(result)

    expect(parsed).toEqual(preset)
  })

  it('throws when editor command fails', async () => {
    const preset: CommunityDefaultsPreset = {
      boardSettings: {},
      boardManagerSettings: {},
    }

    await expect(openPresetInEditor(preset, 'false')).rejects.toThrow('Editor exited with code 1')
  })

  it('throws when editor command is not found', async () => {
    const preset: CommunityDefaultsPreset = {
      boardSettings: {},
      boardManagerSettings: {},
    }

    await expect(
      openPresetInEditor(preset, 'nonexistent-editor-command-xyz'),
    ).rejects.toThrow('Failed to launch editor')
  })
})
