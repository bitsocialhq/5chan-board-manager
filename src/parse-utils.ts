/** Type guard for oclif's NonExistentFlagsError (not publicly exported) */
export function isNonExistentFlagsError(err: unknown): err is Error & { flags: string[] } {
  return (
    err instanceof Error &&
    Array.isArray((err as Error & { flags?: unknown }).flags) &&
    err.message.startsWith('Nonexistent flag')
  )
}
