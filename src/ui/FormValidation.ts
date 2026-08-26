/** Reusable, dependency-free form validation utilities.
 *
 *  A field's rules are declared as an ordered list of `ValidationRule`s; the
 *  first rule that fails wins the error message for that field. `createValidator`
 *  compiles a rules map into a single validate function that can be reused
 *  across renders (e.g. in TransformPanel) without re-allocating rule objects.
 *
 *  `value` is typed `unknown` because rules and the values map are matched up
 *  by field name across arbitrary form shapes; every rule narrows the value
 *  itself before testing it, and callers get pass/fail back via
 *  `ValidationResult`. */

export interface ValidationRule {
  validate: (value: unknown) => boolean
  message: string
}

export interface ValidationResult {
  isValid: boolean
  errors: Record<string, string>
}

/** Builds a validator function from a map of field name -> rules.
 *  The returned function checks every field's rules in order and stops at the
 *  first failing rule per field, collecting that rule's message as the error. */
export function createValidator(
  rules: Record<string, ValidationRule[]>,
): (values: Record<string, unknown>) => ValidationResult {
  return (values: Record<string, unknown>): ValidationResult => {
    const errors: Record<string, string> = {}

    for (const field of Object.keys(rules)) {
      const fieldRules = rules[field]!
      const value = values[field]

      for (const rule of fieldRules) {
        if (!rule.validate(value)) {
          errors[field] = rule.message
          break
        }
      }
    }

    return { isValid: Object.keys(errors).length === 0, errors }
  }
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (typeof value === 'number') return Number.isNaN(value)
  return false
}

export const validators = {
  /** Fails when the value is null/undefined, an empty (whitespace-only) string, or NaN. */
  required: (fieldName: string): ValidationRule => ({
    validate: (value: unknown) => !isEmpty(value),
    message: `${fieldName} is required`,
  }),

  /** Fails when the value is not a finite number, or is below `min`. */
  minValue: (min: number): ValidationRule => ({
    validate: (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= min,
    message: `Must be at least ${min}`,
  }),

  /** Fails when the value is not a finite number, or is above `max`. */
  maxValue: (max: number): ValidationRule => ({
    validate: (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value <= max,
    message: `Must be at most ${max}`,
  }),

  /** Fails when the value is not a finite number greater than zero. */
  positive: (): ValidationRule => ({
    validate: (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0,
    message: 'Must be a positive number',
  }),

  /** Fails when the value is not an integer (whole finite number). */
  integer: (): ValidationRule => ({
    validate: (value: unknown) => typeof value === 'number' && Number.isInteger(value),
    message: 'Must be a whole number',
  }),
}
