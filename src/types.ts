import type PlebbitFn from '@plebbit/plebbit-js'

/** The Plebbit instance type returned by `await Plebbit()` */
export type PlebbitInstance = Awaited<ReturnType<typeof PlebbitFn>>

export interface ArchiverOptions {
  subplebbitAddress: string
  plebbit: PlebbitInstance
  perPage?: number
  pages?: number
  bumpLimit?: number
  archivePurgeSeconds?: number
}

export interface ArchiverResult {
  stop: () => void
}

export interface SignerState {
  privateKey: string
}

export interface LockedThread {
  lockTimestamp: number
}

export interface ArchiverState {
  signers: Record<string, SignerState>
  lockedThreads: Record<string, LockedThread>
}
