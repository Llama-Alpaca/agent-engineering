import { assert } from "../../common/trace.ts"
import {
  DeterministicAdapter,
  collectStream,
  collectWithRetry,
  happyScript,
  normalizeChunk,
  type StreamRequest,
} from "../code.ts"

const request: StreamRequest = {
  requestId: "test-stream",
  provider: "scripted",
  model: "scripted-model",
  system: "system",
  prompt: "prompt",
  tools: ["read_file"],
  promptTokens: 5,
  contextWindow: 64,
  adapterDefaults: { temperature: 0 },
}

const adapter = new DeterministicAdapter({ script: happyScript() })
const prepared = adapter.prepareCall(request)
assert(prepared.route === "scripted/scripted-model", "route should be fixed at prepare")
assert(prepared.temperature === 0 && prepared.stream, "adapter defaults should be fixed")

const happy = await collectStream(adapter, request)
assert(happy.status === "ok" && happy.committed, "happy stream did not commit")
assert(happy.message?.toolCalls[0]?.arguments.path === "RELEASE.md", "tool arguments assembled incorrectly")
assert(happy.message?.usage?.outputTokens === 17, "trailing usage was lost")

let commitCount = 0
const cancelled = new AbortController()
const canceledOutcome = await collectStream(adapter, { ...request, requestId: "cancel" }, {
  signal: cancelled.signal,
  onChunk: (_chunk, index) => {
    if (index === 1) cancelled.abort()
  },
  onCommit: () => {
    commitCount += 1
  },
})
assert(canceledOutcome.status === "cancelled" && !canceledOutcome.committed, "cancel should discard stream")
assert(commitCount === 0, "cancelled stream invoked commit callback")

const retried = await collectWithRetry(
  new DeterministicAdapter({ script: happyScript(), failAttempts: 1 }),
  { ...request, requestId: "retry" },
  2,
)
assert(retried.status === "ok" && retried.attempts === 2, "retry count incorrect")

const afterFinish = await collectStream(
  new DeterministicAdapter({
    script: [
      { kind: "finish", reason: "stop" },
      { kind: "text", delta: "must not be accepted" },
    ],
  }),
  { ...request, requestId: "after-finish" },
)
assert(afterFinish.status === "error" && !afterFinish.committed, "chunks after finish must be rejected")
assert(afterFinish.error?.code === "MALFORMED_CHUNK", "post-finish chunk needs a stable protocol error")

const finishAbort = new AbortController()
let finishAbortCommits = 0
const abortedAtFinish = await collectStream(
  new DeterministicAdapter({ script: [{ kind: "finish", reason: "stop" }] }),
  { ...request, requestId: "abort-at-finish" },
  {
    signal: finishAbort.signal,
    onChunk: (chunk) => {
      if (chunk.kind === "finish") finishAbort.abort()
    },
    onCommit: () => {
      finishAbortCommits += 1
    },
  },
)
assert(abortedAtFinish.status === "cancelled" && !abortedAtFinish.committed, "abort at finish must win before commit")
assert(finishAbortCommits === 0, "abort-at-finish invoked commit callback")

let malformed = false
try {
  normalizeChunk({ kind: "unknown" })
} catch (error) {
  malformed = error instanceof Error && error.message.includes("unknown chunk")
}
assert(malformed, "unknown chunk must be rejected")

console.log("L05 tests: ok")
