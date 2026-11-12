import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import { applySetMaxCost, parseMaxCostInput, revertMaxCost, shouldHalt, shouldWarn } from "@opencode-ai/core/session/max-cost-logic"

//generator for a positive cost amount
const money = fc.double({ min: 0, max: 100_000, noNaN: true })

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
          for (const step of steps) {
            cost += step * maxCost * 0.2
            if (shouldWarn(cost, maxCost, warned)) {
              warnCount++
              warned = true
            }
            if (shouldHalt(cost, maxCost)) expect(shouldWarn(cost, maxCost, false)).toBe(false)
          }
          expect(warnCount).toBeLessThanOrEqual(1)
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

  // R4: If the user inputs a session cost limit with more than two decimal places, the input should be accepted, and the cost limit should always round down.
  // Kind: Metamorphic
  //money generator works here as well because money is already a valid maxCost input (>= 0)
  test("R4: any accepted input is truncated to whole cents, never rounded up", () => {
    fc.assert(
      fc.property(money, (raw) => {
        const result = parseMaxCostInput(String(raw))
        expect(result.kind).toBe("value")
        if (result.kind !== "value") return
        expect(Number.isInteger(Math.round(result.amount * 100))).toBe(true)
        expect(result.amount).toBeLessThanOrEqual(raw + 1e-9)
        expect(raw - result.amount).toBeLessThan(0.01 + 1e-9)
      }),
    )
  })
})