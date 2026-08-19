import { strict as nodeAssert } from "node:assert"
import {
  AcpPromptBridge,
  ContentAdmissionError,
  JsonRpcLinePeer,
  MemoryImageStore,
  admitAcpPrompt,
  assistantBlockToAcp,
  decodeJsonRpcLine,
  runProtocolLab,
  supportsImagePrompts,
} from "../code.ts"

const facts = await runProtocolLab()
nodeAssert.equal(facts.malformedIgnored, true)
nodeAssert.equal(facts.missingCode, -32601)
nodeAssert.equal(facts.handlerCode, -32603)
nodeAssert.equal(facts.notificationResponses, 0)
nodeAssert.deepEqual(facts.projectedTypes, ["text", "image", "text"])
nodeAssert.equal(facts.cancelledObjects, 1)
nodeAssert.equal(facts.cancelledMessages, 0)

nodeAssert.equal(decodeJsonRpcLine("not json"), undefined)
nodeAssert.deepEqual(
  decodeJsonRpcLine(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "x", params: [1] })),
  { jsonrpc: "2.0", id: 1, method: "x", params: {} },
)
const peer = new JsonRpcLinePeer()
peer.diagnostic("stderr only")
const ignored = await peer.handleLine("{")
nodeAssert.deepEqual(ignored.stdout, [])
nodeAssert.deepEqual(ignored.diagnostics, ["stderr only"])

const store = new MemoryImageStore()
nodeAssert.equal(supportsImagePrompts({ store, deploymentMediaTypes: ["image/png"], modelInputModalities: ["text", "image"] }), true)
nodeAssert.equal(supportsImagePrompts({ store, deploymentMediaTypes: ["image/png"], modelInputModalities: ["text"] }), false)

const signal = new AbortController().signal
await nodeAssert.rejects(
  admitAcpPrompt({
    prompt: [
      { type: "image", mimeType: "image/png", data: Buffer.from("valid").toString("base64") },
      { type: "audio", data: "ignored" },
    ],
    imageEnabled: true,
    currentRouteSupportsImage: true,
    store,
    signal,
  }),
  (error: unknown) => error instanceof ContentAdmissionError && /audio/.test(error.message),
)
nodeAssert.equal(store.saveCalls, 0, "whole-prompt validation must precede persistence")

await nodeAssert.rejects(
  admitAcpPrompt({
    prompt: [{ type: "image", mimeType: "image/png", data: "AA-_" }],
    imageEnabled: true,
    currentRouteSupportsImage: true,
    store,
    signal,
  }),
  /canonical base64/,
)

const bridge = new AcpPromptBridge()
await bridge.prompt({
  prompt: [{ type: "image", mimeType: "image/jpeg", data: Buffer.from("jpeg").toString("base64") }],
  imageEnabled: true,
  currentRouteSupportsImage: true,
  store,
  signal,
})
const image = bridge.durableMessages[0]?.content[0]
nodeAssert.ok(image !== undefined)
nodeAssert.equal(assistantBlockToAcp(image, store)?.type, "image")

console.log("advanced L00 tests: ok")
