import Plebbit from '@plebbit/plebbit-js'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { z } from 'zod'
import type { Subplebbit } from './types.js'

type SubplebbitEditOptions = Parameters<Subplebbit['edit']>[0]
type ParseSubplebbitEditOptionsFn = (editOptions: SubplebbitEditOptions) => SubplebbitEditOptions

export const BoardManagerSettingsSchema = z.object({
  perPage: z.number().int().positive().optional(),
  pages: z.number().int().positive().optional(),
  bumpLimit: z.number().int().positive().optional(),
  archivePurgeSeconds: z.number().int().positive().optional(),
}).strict()

export const CommunityDefaultsPresetBaseSchema = z.object({
  boardSettings: z.record(z.string(), z.unknown()),
  boardManagerSettings: BoardManagerSettingsSchema,
}).strict()

export interface CommunityDefaultsPreset {
  boardSettings: SubplebbitEditOptions
  boardManagerSettings: z.infer<typeof BoardManagerSettingsSchema>
}

export type BoardManagerDefaults = z.infer<typeof BoardManagerSettingsSchema>

export interface ApplyCommunityDefaultsResult {
  applied: boolean
  changedFields: string[]
}

const COMMUNITY_DEFAULTS_PRESET_PATH = fileURLToPath(
  new URL('./presets/community-defaults.json', import.meta.url),
)
const require = createRequire(import.meta.url)
let parseSubplebbitEditOptionsPromise: Promise<ParseSubplebbitEditOptionsFn> | undefined
let communityDefaultsPresetPromise: Promise<CommunityDefaultsPreset> | undefined
let parseSubplebbitEditOptionsOverride: ParseSubplebbitEditOptionsFn | undefined

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function getParseSubplebbitEditOptions(): Promise<ParseSubplebbitEditOptionsFn> {
  if (parseSubplebbitEditOptionsOverride) {
    return parseSubplebbitEditOptionsOverride
  }

  if (!parseSubplebbitEditOptionsPromise) {
    parseSubplebbitEditOptionsPromise = (async () => {
      const plebbitEntrypointPath = require.resolve('@plebbit/plebbit-js')
      const schemaUtilModulePath = join(dirname(plebbitEntrypointPath), 'schema', 'schema-util.js')
      const schemaUtilModule = (await import(pathToFileURL(schemaUtilModulePath).href)) as {
        parseSubplebbitEditOptionsSchemaWithPlebbitErrorIfItFails?: ParseSubplebbitEditOptionsFn
      }

      if (!schemaUtilModule.parseSubplebbitEditOptionsSchemaWithPlebbitErrorIfItFails) {
        throw new Error(
          `Failed to load parseSubplebbitEditOptionsSchemaWithPlebbitErrorIfItFails from "${schemaUtilModulePath}"`,
        )
      }

      return schemaUtilModule.parseSubplebbitEditOptionsSchemaWithPlebbitErrorIfItFails
    })()
  }

  return parseSubplebbitEditOptionsPromise
}

/** Test hook to avoid loading the full plebbit-js schema module inside Vitest's runtime. */
export function setParseSubplebbitEditOptionsOverrideForTests(
  parser: ParseSubplebbitEditOptionsFn | undefined,
): void {
  parseSubplebbitEditOptionsOverride = parser
}

export function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
      return `${path}: ${issue.message}`
    })
    .join('; ')
}

export async function loadCommunityDefaultsPreset(
  presetPath = COMMUNITY_DEFAULTS_PRESET_PATH,
): Promise<CommunityDefaultsPreset> {
  let raw: string
  try {
    raw = readFileSync(presetPath, 'utf-8')
  } catch (err) {
    throw new Error(
      `Failed to read community defaults preset "${presetPath}": ${(err as Error).message}`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(
      `Invalid JSON in community defaults preset "${presetPath}": ${(err as Error).message}`,
    )
  }

  const baseResult = CommunityDefaultsPresetBaseSchema.safeParse(parsed)
  if (!baseResult.success) {
    throw new Error(
      `Invalid community defaults preset "${presetPath}": ${formatZodIssues(baseResult.error)}`,
    )
  }

  const parseSubplebbitEditOptions = await getParseSubplebbitEditOptions()
  let boardSettings: SubplebbitEditOptions
  try {
    boardSettings = parseSubplebbitEditOptions(baseResult.data.boardSettings as SubplebbitEditOptions)
  } catch (err) {
    throw new Error(
      `Invalid community defaults preset "${presetPath}": ${(err as Error).message}`,
    )
  }

  return {
    boardSettings,
    boardManagerSettings: baseResult.data.boardManagerSettings,
  }
}

export async function getCommunityDefaultsPreset(): Promise<CommunityDefaultsPreset> {
  if (!communityDefaultsPresetPromise) {
    communityDefaultsPresetPromise = loadCommunityDefaultsPreset()
  }
  return communityDefaultsPresetPromise
}

export function buildMissingObjectPatch(
  currentValue: unknown,
  defaults: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (currentValue !== undefined && !isPlainObject(currentValue)) {
    return undefined
  }

  const currentObject = isPlainObject(currentValue) ? currentValue : undefined
  const patch: Record<string, unknown> = {}

  for (const [key, defaultValue] of Object.entries(defaults)) {
    const existingValue = currentObject?.[key]

    if (isPlainObject(defaultValue)) {
      if (existingValue === undefined) {
        patch[key] = structuredClone(defaultValue)
        continue
      }

      if (isPlainObject(existingValue)) {
        const nestedPatch = buildMissingObjectPatch(existingValue, defaultValue)
        if (nestedPatch !== undefined) {
          patch[key] = nestedPatch
        }
      }

      continue
    }

    if (existingValue === undefined) {
      patch[key] = structuredClone(defaultValue)
    }
  }

  return Object.keys(patch).length > 0 ? patch : undefined
}

export function buildCommunityDefaultsPatch(
  subplebbit: Subplebbit,
  preset: CommunityDefaultsPreset,
): { patch: SubplebbitEditOptions | undefined; changedFields: string[] } {
  const boardSettings = preset.boardSettings as Record<string, unknown>
  const patch = buildMissingObjectPatch(subplebbit, boardSettings)
  const changedFields = patch ? Object.keys(patch) : []

  return {
    patch: patch ? (patch as SubplebbitEditOptions) : undefined,
    changedFields,
  }
}

export async function applyCommunityDefaultsToBoard(
  address: string,
  rpcUrl: string,
  preset: CommunityDefaultsPreset,
): Promise<ApplyCommunityDefaultsResult> {
  const plebbit = await Plebbit({ plebbitRpcClientsOptions: [rpcUrl] })

  try {
    const subplebbit = await plebbit.getSubplebbit({ address })
    const { patch, changedFields } = buildCommunityDefaultsPatch(subplebbit, preset)
    if (!patch) {
      return { applied: false, changedFields: [] }
    }

    await subplebbit.edit(patch)

    return { applied: true, changedFields }
  } finally {
    await plebbit.destroy()
  }
}
