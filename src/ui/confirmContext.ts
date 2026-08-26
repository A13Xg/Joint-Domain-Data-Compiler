// Context plumbing for the confirm dialog.
//
// Split from ConfirmProvider.tsx because component files may only export
// components (react-refresh/only-export-components); the context object and
// the hook live here so the provider file stays a pure component module.

import { createContext, useContext } from 'react'
import type { ConfirmRequest } from './ConfirmDialog'

export type ConfirmFn = (request: ConfirmRequest) => Promise<boolean>

/**
 * Falls back to window.confirm when no provider is mounted.
 *
 * Tests and Storybook-style harnesses render panels in isolation, and a
 * destructive action that silently resolved `true` without a provider would be
 * a genuinely dangerous default.
 */
const fallback: ConfirmFn = (request) => Promise.resolve(window.confirm(`${request.title}\n\n${request.message}`))

export const ConfirmContext = createContext<ConfirmFn>(fallback)

/** Returns an async confirm; resolves true when the user proceeds. */
export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext)
}
