import { createValidator, validators } from '../src/ui/FormValidation.ts'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

// --- validators.required -----------------------------------------------

const requiredRule = validators.required('Name')
check('required passes for a non-empty string', requiredRule.validate('hello') === true)
check('required fails for an empty string', requiredRule.validate('') === false)
check('required fails for a whitespace-only string', requiredRule.validate('   ') === false)
check('required fails for undefined', requiredRule.validate(undefined) === false)
check('required fails for null', requiredRule.validate(null) === false)
check('required fails for NaN', requiredRule.validate(NaN) === false)
check('required passes for the number 0', requiredRule.validate(0) === true)
check('required message includes field name', requiredRule.message === 'Name is required')

// --- validators.minValue -------------------------------------------------

const minRule = validators.minValue(10)
check('minValue passes for a value equal to the minimum', minRule.validate(10) === true)
check('minValue passes for a value above the minimum', minRule.validate(15) === true)
check('minValue fails for a value below the minimum', minRule.validate(5) === false)
check('minValue fails for a non-number', minRule.validate('10') === false)
check('minValue fails for NaN', minRule.validate(NaN) === false)

// --- validators.maxValue -------------------------------------------------

const maxRule = validators.maxValue(100)
check('maxValue passes for a value equal to the maximum', maxRule.validate(100) === true)
check('maxValue passes for a value below the maximum', maxRule.validate(50) === true)
check('maxValue fails for a value above the maximum', maxRule.validate(150) === false)
check('maxValue fails for a non-number', maxRule.validate('50') === false)

// --- validators.positive --------------------------------------------------

const positiveRule = validators.positive()
check('positive passes for a positive number', positiveRule.validate(1) === true)
check('positive fails for zero', positiveRule.validate(0) === false)
check('positive fails for a negative number', positiveRule.validate(-1) === false)
check('positive fails for a non-number', positiveRule.validate('1') === false)
check('positive fails for Infinity', positiveRule.validate(Infinity) === false)

// --- validators.integer ----------------------------------------------------

const integerRule = validators.integer()
check('integer passes for a whole number', integerRule.validate(4) === true)
check('integer passes for a negative whole number', integerRule.validate(-4) === true)
check('integer fails for a decimal number', integerRule.validate(4.5) === false)
check('integer fails for a non-number', integerRule.validate('4') === false)
check('integer fails for NaN', integerRule.validate(NaN) === false)

// --- createValidator: single rule per field ------------------------------

const simpleValidate = createValidator({
  name: [validators.required('Name')],
})

const simplePass = simpleValidate({ name: 'Alex' })
check('createValidator: isValid true when required field is present', simplePass.isValid === true)
check('createValidator: no error recorded when required field is present', simplePass.errors.name === undefined)

const simpleFail = simpleValidate({ name: '' })
check('createValidator: isValid false when required field is missing', simpleFail.isValid === false)
check('createValidator: error message recorded for missing required field', simpleFail.errors.name === 'Name is required')

// --- createValidator: multiple rules on one field, stops at first failure ---

const rateValidate = createValidator({
  rate: [validators.required('Rate'), validators.positive(), validators.integer(), validators.maxValue(100)],
})

const rateAllPass = rateValidate({ rate: 10 })
check('createValidator: all rules pass for a valid integer within range', rateAllPass.isValid === true)

const rateMissing = rateValidate({ rate: undefined })
check('createValidator: required rule fires first when value is missing', rateMissing.errors.rate === 'Rate is required')

const rateNegative = rateValidate({ rate: -5 })
check('createValidator: positive rule fires for a negative value', rateNegative.errors.rate === 'Must be a positive number')

const rateDecimal = rateValidate({ rate: 5.5 })
check('createValidator: integer rule fires for a decimal value that is positive', rateDecimal.errors.rate === 'Must be a whole number')

const rateTooLarge = rateValidate({ rate: 500 })
check('createValidator: maxValue rule fires only after earlier rules pass', rateTooLarge.errors.rate === 'Must be at most 100')

// --- createValidator: multiple independent fields --------------------------

const multiFieldValidate = createValidator({
  label: [validators.required('Label')],
  count: [validators.required('Count'), validators.integer(), validators.minValue(1)],
})

const multiFieldAllPass = multiFieldValidate({ label: 'Track A', count: 3 })
check('createValidator: multi-field validation passes when all fields are valid', multiFieldAllPass.isValid === true)
check('createValidator: multi-field validation has no errors when all fields are valid', Object.keys(multiFieldAllPass.errors).length === 0)

const multiFieldAllFail = multiFieldValidate({ label: '', count: 0 })
check('createValidator: multi-field validation fails when any field is invalid', multiFieldAllFail.isValid === false)
check('createValidator: multi-field validation reports an error per invalid field', Object.keys(multiFieldAllFail.errors).length === 2)
check('createValidator: label error is independent of count error', multiFieldAllFail.errors.label === 'Label is required')
check('createValidator: count error reflects the minValue rule', multiFieldAllFail.errors.count === 'Must be at least 1')

const multiFieldPartialFail = multiFieldValidate({ label: 'Track B', count: 0 })
check('createValidator: only the failing field is reported when others pass', multiFieldPartialFail.isValid === false)
check('createValidator: passing field has no error entry', multiFieldPartialFail.errors.label === undefined)
check('createValidator: failing field has its error entry', multiFieldPartialFail.errors.count === 'Must be at least 1')

// --- createValidator: empty rules map ---------------------------------------

const noopValidate = createValidator({})
const noopResult = noopValidate({ anything: 'goes' })
check('createValidator: validator with no rules is always valid', noopResult.isValid === true)

console.log(`\n${failures === 0 ? 'ALL FORM VALIDATION CHECKS PASSED' : `${failures} FORM VALIDATION CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
