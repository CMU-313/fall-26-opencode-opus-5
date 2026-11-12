export type ParsedMaxCost = { kind: "clear" } | { kind: "invalid" } | { kind: "value"; amount: number }

export function shouldWarn(cost: number, maxCost: number, alreadyWarned: boolean): boolean {
  if (!Number.isFinite(maxCost) || alreadyWarned || shouldHalt(cost, maxCost)) return false
  return cost >= maxCost * 0.9
}

// R2: core halt predicate
export function shouldHalt(cost: number, maxCost: number): boolean {
  return cost >= maxCost
}

// R3: the two pure state transitions behind /maxcost and /prevmaxcost
export function applySetMaxCost(
  current: { maxCost?: number; previousMaxCost?: number },
  amount: number,
): { maxCost: number; previousMaxCost: number | undefined } {
  return { maxCost: amount, previousMaxCost: current.maxCost ?? current.previousMaxCost }
}

// rounds the max cost
export function parseMaxCostInput(raw: string): ParsedMaxCost {
  const text = raw.trim()
  if (text === "") return { kind: "clear" }
  const n = Number(text)
  if (!Number.isFinite(n) || n < 0) return { kind: "invalid" }
  return { kind: "value", amount: Math.floor(n * 100 + 1e-9) / 100 }
}

export function revertMaxCost(
  current: { maxCost?: number; previousMaxCost?: number },
): { ok: true; maxCost: number; previousMaxCost: number | undefined } | { ok: false } {
  if (current.previousMaxCost === undefined) return { ok: false }
  return { ok: true, maxCost: current.previousMaxCost, previousMaxCost: current.maxCost }
}