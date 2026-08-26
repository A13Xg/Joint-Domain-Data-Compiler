// Error normalization. Nothing thrown in JavaScript is guaranteed to be an
// Error, so every catch site in the app funnels through here rather than
// casting. A cast (`(error as Error).message`) yields the literal string
// "undefined" when a non-Error is thrown, and throws a second TypeError inside
// the catch block when the thrown value is null or a primitive — turning a
// recoverable failure into an unhandled one with no readout at all.

/** Human-readable message for anything a `catch` can receive. Never throws. */
export function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message || cause.name || 'Unknown error'
  if (typeof cause === 'string') return cause || 'Unknown error'
  if (cause === null || cause === undefined) return 'Unknown error'
  if (typeof cause === 'object') {
    // Structured-clone'd errors and DOMExceptions cross worker/IPC boundaries
    // as plain objects and lose their prototype, so `instanceof` misses them.
    const message = (cause as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
    try {
      // String(plainObject) is "[object Object]" — useless in a toast.
      const json = JSON.stringify(cause)
      if (json && json !== '{}') return json
    } catch {
      // Circular or non-serializable: fall through to String().
    }
  }
  // Objects are handled above, so anything reaching here is a primitive
  // (symbol, bigint, boolean) for which String() is the correct rendering.
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- primitives only by construction
  return String(cause)
}

/** Coerce anything a `catch` can receive into a real Error, preserving `cause`. */
export function toError(cause: unknown): Error {
  if (cause instanceof Error) return cause
  return new Error(errorMessage(cause), { cause })
}

/** True for a cancellation, however it crossed a worker or DOM boundary. */
export function isAbortError(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && (cause as { name?: unknown }).name === 'AbortError'
}
