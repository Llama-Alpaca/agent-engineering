/**
 * L00 - the two protocol boundaries added around the same Harness core.
 *
 * The JSON-RPC half follows JsonRpcLineTransport: NDJSON framing, malformed
 * peer lines ignored, -32601 for a missing request handler, -32603 for a
 * throwing handler, and no response for notifications. The ACP half follows
 * the rich-content bridge: validate a whole prompt before storing images,
 * preserve block order, and never enqueue after admission cancellation.
 */

import { assert, printResult, type JsonValue } from "../../deepseek-harness-lessons/common/trace.ts"

export type RpcId = string | number

export type RpcFrame =
  | { readonly jsonrpc: "2.0"; readonly id: RpcId; readonly method: string; readonly params?: Record<string, unknown> }
  | { readonly jsonrpc: "2.0"; readonly method: string; readonly params?: Record<string, unknown> }
  | { readonly jsonrpc: "2.0"; readonly id: RpcId; readonly result?: unknown; readonly error?: { readonly code?: number; readonly message?: string; readonly data?: unknown } }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** JsonRpcLineTransport ignores syntax errors and non-frame JSON values. */
export function decodeJsonRpcLine(line: string): RpcFrame | undefined {
  if (line.trim() === "") return undefined
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return undefined
  }
  if (!isRecord(value)) return undefined
  const id = value.id
  const method = value.method
  const params = isRecord(value.params) ? value.params : {}
  if (typeof method === "string") {
    if (typeof id === "string" || typeof id === "number") return { jsonrpc: "2.0", id, method, params }
    return { jsonrpc: "2.0", method, params }
  }
  if (typeof id !== "string" && typeof id !== "number") return undefined
  return {
    jsonrpc: "2.0",
    id,
    ...(isRecord(value.error) ? { error: value.error } : { result: value.result }),
  }
}

export type RpcHandler = (method: string, params: Record<string, unknown>) => unknown | Promise<unknown>

export interface LineResult {
  readonly stdout: readonly string[]
  readonly diagnostics: readonly string[]
}

/** A small server-side peer with protocol stdout separated from diagnostics. */
export class JsonRpcLinePeer {
  private readonly diagnostics: string[] = []
  private handler: RpcHandler | undefined

  onRequest(handler: RpcHandler): void {
    this.handler = handler
  }

  diagnostic(message: string): void {
    this.diagnostics.push(message)
  }

  async handleLine(line: string): Promise<LineResult> {
    const frame = decodeJsonRpcLine(line)
    if (frame === undefined || !("method" in frame)) return this.result([])
    if (!("id" in frame)) {
      if (this.handler !== undefined) {
        try {
          await this.handler(frame.method, frame.params ?? {})
        } catch (error) {
          this.diagnostic(`notification failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      return this.result([])
    }
    if (this.handler === undefined) {
      return this.result([this.encode({ jsonrpc: "2.0", id: frame.id, error: { code: -32601, message: `method not found: ${frame.method}` } })])
    }
    try {
      const value = await this.handler(frame.method, frame.params ?? {})
      return this.result([this.encode({ jsonrpc: "2.0", id: frame.id, result: value })])
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.result([this.encode({ jsonrpc: "2.0", id: frame.id, error: { code: -32603, message } })])
    }
  }

  private encode(frame: Record<string, unknown>): string {
    return JSON.stringify(frame)
  }

  private result(stdout: readonly string[]): LineResult {
    return { stdout, diagnostics: [...this.diagnostics] }
  }
}

export type ImageMime = "image/png" | "image/jpeg" | "image/webp" | "image/gif"

export type AcpPromptBlock =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly mimeType: string; readonly data: string }
  | { readonly type: "resource_link"; readonly name: string; readonly uri: string }
  | { readonly type: "audio"; readonly data: string }
  | { readonly type: "resource"; readonly uri: string }

export type CoreContentBlock =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly attachment: ImageRef }

export interface ImageRef {
  readonly id: string
  readonly mediaType: ImageMime
  readonly size: number
}

interface StoredImage {
  readonly ref: ImageRef
  readonly bytes: Uint8Array
}

const IMAGE_MIMES: readonly ImageMime[] = ["image/png", "image/jpeg", "image/webp", "image/gif"]
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

function imageMime(value: string): ImageMime | undefined {
  return IMAGE_MIMES.includes(value as ImageMime) ? value as ImageMime : undefined
}

export class ContentAdmissionError extends Error {
  readonly kind: "invalid" | "internal"

  constructor(message: string, kind: "invalid" | "internal" = "invalid") {
    super(message)
    this.name = "ContentAdmissionError"
    this.kind = kind
  }
}

/** Deterministic attachment store; saveImages is one ordered batch. */
export class MemoryImageStore {
  private readonly images = new Map<string, StoredImage>()
  private nextId = 0
  saveCalls = 0
  afterSave: (() => void) | undefined

  saveImages(images: readonly { readonly mediaType: ImageMime; readonly bytes: Uint8Array }[]): readonly ImageRef[] {
    this.saveCalls += 1
    const refs = images.map((image) => {
      const ref: ImageRef = { id: `image-${this.nextId++}`, mediaType: image.mediaType, size: image.bytes.byteLength }
      this.images.set(ref.id, { ref, bytes: Uint8Array.from(image.bytes) })
      return ref
    })
    this.afterSave?.()
    return refs
  }

  readImage(ref: ImageRef): Uint8Array {
    const stored = this.images.get(ref.id)
    assert(stored !== undefined && stored.ref.mediaType === ref.mediaType && stored.ref.size === ref.size, "attachment unavailable or corrupt")
    return Uint8Array.from(stored.bytes)
  }

  get size(): number {
    return this.images.size
  }
}

export function supportsImagePrompts(options: {
  readonly store?: MemoryImageStore
  readonly deploymentMediaTypes: readonly string[]
  readonly modelInputModalities?: readonly string[]
}): boolean {
  return options.store !== undefined
    && options.deploymentMediaTypes.some((item) => IMAGE_MIMES.includes(item as ImageMime))
    && options.modelInputModalities?.includes("image") === true
}

function decodeImage(block: Extract<AcpPromptBlock, { readonly type: "image" }>): { readonly mediaType: ImageMime; readonly bytes: Uint8Array } {
  const mediaType = imageMime(block.mimeType)
  if (mediaType === undefined) throw new ContentAdmissionError("unsupported image mimeType")
  if (!CANONICAL_BASE64.test(block.data)) throw new ContentAdmissionError("image data must be canonical base64")
  const bytes = Buffer.from(block.data, "base64")
  if (bytes.toString("base64") !== block.data) throw new ContentAdmissionError("image data must be canonical base64")
  return { mediaType, bytes }
}

function resourceLinkText(block: Extract<AcpPromptBlock, { readonly type: "resource_link" }>): string {
  return `\n[resource_link name=${JSON.stringify(block.name)} uri=${JSON.stringify(block.uri)}]\n`
}

/** Validate every wire block before the first persistence side effect. */
export async function admitAcpPrompt(options: {
  readonly prompt: readonly AcpPromptBlock[]
  readonly imageEnabled: boolean
  readonly currentRouteSupportsImage: boolean
  readonly store?: MemoryImageStore
  readonly signal: AbortSignal
}): Promise<readonly CoreContentBlock[]> {
  const images: { readonly mediaType: ImageMime; readonly bytes: Uint8Array }[] = []
  for (const block of options.prompt) {
    if (block.type === "audio") throw new ContentAdmissionError("audio prompt content is not supported")
    if (block.type === "resource") throw new ContentAdmissionError("embedded resource prompt content is not supported")
    if (block.type === "image") {
      if (!options.imageEnabled) throw new ContentAdmissionError("inline image prompts were not advertised")
      images.push(decodeImage(block))
    }
  }
  if (images.length > 0 && !options.currentRouteSupportsImage) {
    throw new ContentAdmissionError("current model route does not declare image input")
  }
  options.signal.throwIfAborted()
  let refs: readonly ImageRef[] = []
  if (images.length > 0) {
    if (options.store === undefined) throw new ContentAdmissionError("no attachment store is mounted")
    refs = options.store.saveImages(images)
  }
  options.signal.throwIfAborted()

  const content: CoreContentBlock[] = []
  let text = ""
  let imageIndex = 0
  const flushText = (): void => {
    if (text.length > 0) content.push({ type: "text", text })
    text = ""
  }
  for (const block of options.prompt) {
    if (block.type === "text") text += block.text
    else if (block.type === "resource_link") text += resourceLinkText(block)
    else if (block.type === "image") {
      flushText()
      content.push({ type: "image", attachment: refs[imageIndex++] as ImageRef })
    }
  }
  flushText()
  if (!content.some((block) => block.type === "image" || block.text.trim().length > 0)) {
    throw new ContentAdmissionError("empty prompt")
  }
  return content
}

/** Only committed text/image blocks are projected back to ACP. */
export function assistantBlockToAcp(block: CoreContentBlock, store: MemoryImageStore): AcpPromptBlock | undefined {
  if (block.type === "text") return block.text.length === 0 ? undefined : block
  const bytes = store.readImage(block.attachment)
  return { type: "image", mimeType: block.attachment.mediaType, data: Buffer.from(bytes).toString("base64") }
}

export class AcpPromptBridge {
  readonly durableMessages: { readonly id: string; readonly content: readonly CoreContentBlock[] }[] = []
  private inFlight = false
  private nextMessage = 0

  async prompt(options: Parameters<typeof admitAcpPrompt>[0]): Promise<{ readonly messageId: string; readonly stopReason: "end_turn" }> {
    assert(!this.inFlight, "a prompt is already in flight for this session")
    this.inFlight = true
    try {
      const content = await admitAcpPrompt(options)
      options.signal.throwIfAborted()
      const messageId = `message-${this.nextMessage++}`
      this.durableMessages.push({ id: messageId, content })
      return { messageId, stopReason: "end_turn" }
    } finally {
      this.inFlight = false
    }
  }
}

export async function runProtocolLab(): Promise<Record<string, JsonValue>> {
  const peer = new JsonRpcLinePeer()
  const malformed = await peer.handleLine("{not-json")
  const missing = await peer.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "missing" }))
  peer.onRequest((method, params) => {
    if (method === "explode") throw new Error("boom")
    return { method, params }
  })
  const notification = await peer.handleLine(JSON.stringify({ jsonrpc: "2.0", method: "observe", params: ["normalized"] }))
  const failed = await peer.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "explode" }))

  const store = new MemoryImageStore()
  const controller = new AbortController()
  const bridge = new AcpPromptBridge()
  const admitted = await bridge.prompt({
    prompt: [
      { type: "text", text: "inspect " },
      { type: "image", mimeType: "image/png", data: Buffer.from("png").toString("base64") },
      { type: "resource_link", name: "spec", uri: "file:///spec.md" },
    ],
    imageEnabled: true,
    currentRouteSupportsImage: true,
    store,
    signal: controller.signal,
  })
  const projected = bridge.durableMessages[0]?.content.map((block) => assistantBlockToAcp(block, store)).filter((block) => block !== undefined) ?? []

  const cancelledStore = new MemoryImageStore()
  const cancelled = new AbortController()
  cancelledStore.afterSave = () => cancelled.abort(new Error("cancelled during admission"))
  const cancelledBridge = new AcpPromptBridge()
  let cancelledRejected = false
  try {
    await cancelledBridge.prompt({
      prompt: [{ type: "image", mimeType: "image/png", data: Buffer.from("late").toString("base64") }],
      imageEnabled: true,
      currentRouteSupportsImage: true,
      store: cancelledStore,
      signal: cancelled.signal,
    })
  } catch {
    cancelledRejected = true
  }

  return {
    malformedIgnored: malformed.stdout.length === 0,
    missingCode: Number(JSON.parse(missing.stdout[0] ?? "{}").error?.code),
    notificationResponses: notification.stdout.length,
    handlerCode: Number(JSON.parse(failed.stdout[0] ?? "{}").error?.code),
    messageId: admitted.messageId,
    projectedTypes: projected.map((block) => block.type),
    cancelledRejected,
    cancelledObjects: cancelledStore.size,
    cancelledMessages: cancelledBridge.durableMessages.length,
  }
}

export async function runLesson(): Promise<void> {
  const facts = await runProtocolLab()
  assert(facts.malformedIgnored === true, "malformed peer lines must be ignored")
  assert(facts.missingCode === -32601 && facts.handlerCode === -32603, "JSON-RPC errors changed")
  assert(facts.cancelledRejected === true && facts.cancelledMessages === 0, "cancelled admission queued a late message")
  printResult("advanced-00-acp-jsonrpc-boundary", facts)
}

const entry = process.argv[1] ?? ""
if (entry.endsWith("/00_acp_jsonrpc_boundary/code.ts") || entry.endsWith("\\00_acp_jsonrpc_boundary\\code.ts")) await runLesson()
