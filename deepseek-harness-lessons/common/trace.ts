/** Small dependency-free helpers shared by the offline course labs. */

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export interface TraceEvent {
  readonly type: string
  readonly data: Readonly<Record<string, JsonValue>>
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function stableJson(value: unknown): string {
  return JSON.stringify(value, Object.keys((value ?? {}) as object).sort(), 2)
}

export function printResult(lesson: string, facts: unknown, events: readonly TraceEvent[] = []): void {
  console.log(JSON.stringify({ lesson, ok: true, facts, events }, null, 2))
}

export function expectThrows(action: () => unknown, fragment: string): void {
  let thrown: unknown
  try {
    action()
  } catch (error) {
    thrown = error
  }
  assert(thrown instanceof Error, `expected an error containing ${fragment}`)
  assert(thrown.message.includes(fragment), `error ${JSON.stringify(thrown.message)} does not contain ${fragment}`)
}
