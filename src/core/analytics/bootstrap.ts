// Registers the product's built-in analytics derivations exactly once. The
// registry (registry.ts) and versioned engines (kinematics.ts, ...) are
// environment-agnostic; this is the one place production code (App.tsx)
// wires them in, as opposed to tests calling registerDerivation directly.
import { getDerivation, registerDerivation } from './registry'
import { standardKinematicsDerivation } from './kinematics'

export function ensureBuiltinDerivationsRegistered(): void {
  // Checks the registry itself (rather than a module-local flag) so this
  // stays correct if a caller (e.g. clearDerivationsForTests in tests) wipes
  // the registry after the first call.
  if (getDerivation(standardKinematicsDerivation.id)) return
  registerDerivation(standardKinematicsDerivation)
}
