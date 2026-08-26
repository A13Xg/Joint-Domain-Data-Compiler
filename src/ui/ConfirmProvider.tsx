// Hosts the single confirm dialog and hands an async `confirm()` to the tree.
//
// One host rather than a dialog per call site: two modals open at once is a
// focus-trap fight, and the resolver below makes that structurally impossible
// by refusing a second request while one is pending.

import { useCallback, useRef, useState } from 'react'
import { ConfirmDialog, type ConfirmRequest } from './ConfirmDialog'
import { ConfirmContext, type ConfirmFn } from './confirmContext'

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const resolverRef = useRef<((accepted: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((next) => new Promise<boolean>((resolve) => {
    // A second request while one is open would orphan the first promise and
    // leave its caller awaiting forever. Decline it instead.
    if (resolverRef.current) { resolve(false); return }
    resolverRef.current = resolve
    setRequest(next)
  }), [])

  const settle = useCallback((accepted: boolean) => {
    const resolver = resolverRef.current
    resolverRef.current = null
    setRequest(null)
    resolver?.(accepted)
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && <ConfirmDialog request={request} onConfirm={() => settle(true)} onCancel={() => settle(false)} />}
    </ConfirmContext.Provider>
  )
}
