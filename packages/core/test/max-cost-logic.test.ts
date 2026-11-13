fc.configureGlobal({ seed: 42 })
import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import { applySetMaxCost, parseMaxCostInput, revertMaxCost, shouldHalt, shouldWarn } from "@opencode-ai/core/session/max-cost-logic"

//generator for a positive cost amount
const money = fc.double({ min: 0, max: 100_000, noNaN: true })
// const withInvalids = fc.double({ min: -1, max: 1, noNaN: true })

describe("maxCost properties", () => {

  // R1: When the current session cost gets close to the session cost limit (for the first time), output a warning message.
  // Kind: invariant
  //generator for maxCost can't be the above 'money' because it must be > 0 for it to be the >90% case and not the limit reached case.
  //generator for steps is an arbitrary number, also has to be greater than 0 so there's at least one step.
  test("R1: 90%-cap warning fires at most once per session", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 100_000, noNaN: true }),
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 50 }),
        (maxCost, steps) => {
          let cost = 0
          let warned = false
          let warnCount = 0
          let shouldWarned = false;
          for (const step of steps) {
            cost += step * maxCost * 0.2
            if (cost >= maxCost * 0.9 && !shouldHalt(cost, maxCost)) {
              shouldWarned = true
            }
            if (shouldWarn(cost, maxCost, warned)) {
              warnCount++
              warned = true
            }
            if (shouldHalt(cost, maxCost)) expect(shouldWarn(cost, maxCost, false)).toBe(false)
          }
          if (!shouldWarned) {
            expect(warnCount).toEqual(0)
          } else {
            expect(warnCount).toEqual(1)
          }
        },
      ),
    )
  })

    // R1b: Warning never fires if it has already fired.
  test("R1: warning does not fire twice, but fires exactly at 90%", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 100_000, noNaN: true }),
        fc.double({ min: 0.9, max: 0.999, noNaN: true }),
        (maxCost, percentage) => {
          expect(shouldWarn(maxCost * percentage, maxCost, true)).toBe(false)
          expect(shouldWarn(0.9 * maxCost, maxCost, false)).toBe(true)
        },
      ),
    )
  })


  // R2: If the session cost limit is set below the current session cost, immediately output a limit-reached warning message.
  // Kind: invariant
  //money generator works for both cost and maxCost because they don't have to be strictly less than or greater, etc. shouldHalt just needs
  //to correspond with the value of cost >= maxCost
  test("R2: the session halts immediately when cost >= cap, for any pair", () => {
    fc.assert(
      fc.property(money, money, (cost, maxCost) => {
        expect(shouldHalt(cost, maxCost)).toBe(cost >= maxCost)
        expect(shouldHalt(cost, cost)).toBe(true)
      }),
    )
  })
  
  // R3: There should be an prevMaxCost (undo) command for reverting the session cost limit after a change is made to it.
  // Kind: Round-trip
  //money generator works for both original and updated since money is already defined to be >= 0 (so a valid maxCost input).
  test("R3: set then revert returns to the original cap", () => {
    fc.assert(
      fc.property(money, money, (original, updated) => {
        const afterSet = applySetMaxCost({ maxCost: original, previousMaxCost: undefined }, updated)
        expect(afterSet).toEqual({ maxCost: updated, previousMaxCost: original })

        const afterRevert = revertMaxCost(afterSet)
        expect(afterRevert).toEqual({ ok: true, maxCost: original, previousMaxCost: updated })

        if (afterRevert.ok) {
          const again = revertMaxCost(afterRevert)
          expect(again).toEqual({ ok: true, maxCost: updated, previousMaxCost: original })
        }
      }),
    )
  })

  // R3b: reverting with no previous value fails
  test("R3: revert with no previous value returns ok: false", () => {
    fc.assert(
      fc.property(fc.option(money, { nil: undefined }), (maxCost) => {
        expect(revertMaxCost({ maxCost })).toEqual({ ok: false })
      }),
    )
  })

  // R4: If the user inputs a session cost limit with more than two decimal places, the input should be accepted, and the cost limit should always round down.
  // Kind: Metamorphic
  //money generator works here as well because money is already a valid maxCost input (>= 0)
  test("R4: any accepted input is truncated to whole cents, never rounded up", () => {
    fc.assert(
      fc.property(money, (raw) => {
        const input = String(raw)
        const result = parseMaxCostInput(input)
        expect(result.kind).toBe("value")
        if (result.kind !== "value") return
        expect(Number.isInteger(Math.round(result.amount * 100))).toBe(true)
        expect(result.amount).toBeLessThanOrEqual(raw + 1e-9)
        expect(raw - result.amount).toBeLessThan(0.01 + 1e-9)
      }),
    )
  })

  test("R4b: whitespace-only input clears the cap", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(" ", "\t", "\n"), {
          minLength: 0,
          maxLength: 20,
        }),
        (chars) => {
          expect(parseMaxCostInput(chars.join(""))).toEqual({
            kind: "clear",
          })
        },
      ),
    )
  })

  test("R4c: negative non-finite inputs are invalid, but zero is valid", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.double({ max: -Number.MIN_VALUE, noNaN: true }),
          fc.constant(NaN),
          fc.constant(0),
        ),
        (raw) => {
          if (raw === 0) {
            expect(parseMaxCostInput(String(raw))).toEqual({
              kind: "value",
              amount: 0,
            })
          } else {
            expect(parseMaxCostInput(String(raw))).toEqual({
              kind: "invalid",
            })
          }
        },
      ),
    )
  })
})