// linkedom's getElementsByTagName('*') wildcard form returns an empty list
// (a limitation of this DOM implementation); querySelectorAll('*') is
// correct. GPX/KML parsing rely on the wildcard form for namespace-agnostic
// element discovery (extension leaves, gx:Track, plain <coordinates>
// blocks), so this patches it for the Node test environment only —
// production code always runs against a real browser DOMParser, where the
// wildcard form already works correctly.
import { DOMParser } from 'linkedom'

function patchWildcardTagName(): void {
  const probe = new DOMParser().parseFromString('<a/>', 'application/xml')
  let owner: unknown = probe
  while (owner && !Object.prototype.hasOwnProperty.call(owner, 'getElementsByTagName')) {
    owner = Object.getPrototypeOf(owner)
  }
  if (!owner) return
  const target = owner as { getElementsByTagName: (name: string) => unknown }
  const original = target.getElementsByTagName
  target.getElementsByTagName = function (this: { querySelectorAll: (selector: string) => unknown }, name: string) {
    if (name === '*') return this.querySelectorAll('*')
    return original.call(this, name)
  }
}

patchWildcardTagName()
;(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser
