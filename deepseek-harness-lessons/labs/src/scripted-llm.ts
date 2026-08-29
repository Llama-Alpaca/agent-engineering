/**
 * Lab 2: a scripted LlmAdapter — one real turn with no API key.
 * First request (no tool result in history): emit one tool call.
 * Any later request: a final text answer. Everything in between —
 * tool pipeline, session events, the turn loop — is the real harness.
 */
import type { Context } from '@deepseek-ai/cordis'
import { CallId, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

export const name = 'lab-scripted-llm'
export const inject = ['llm']

/** The one provider route this plugin owns. */
const PROVIDER = 'lab-scripted'

/** What the scripted "model" should do on its first response. */
export interface Config {
  firstToolCall?: { name: string, args: unknown }
  finalText?: string
  /** Lab 6: a child agent whose prompt contains this marker answers immediately. */
  childMarker?: string
  childFinalText?: string
}

const FINAL_TEXT = 'Lab complete: the scripted model called a real tool and read its result.'

class ScriptedAdapter extends LlmAdapter {
  constructor(private readonly config: Config) {
    super()
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const sawToolResult = options.messages.some(
      (message) => message.content.some((block) => block.type === 'tool-result'),
    )
    const isChild = this.config.childMarker !== undefined
      && JSON.stringify(options.messages).includes(this.config.childMarker)
    if (isChild && !sawToolResult) {
      const text = this.config.childFinalText ?? 'Child complete.'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 4 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } else if (!sawToolResult) {
      const call = this.config.firstToolCall
        ?? { name: 'bash', args: { command: 'echo "hello from the real bash tool"', description: 'Print lab greeting' } }
      const id = CallId('lab-call-1')
      const args = JSON.stringify(call.args)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: call.name, argumentsDelta: '' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: call.name, arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 6 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      const text = this.config.finalText ?? FINAL_TEXT
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'usage', usage: { inputTokens: 24, outputTokens: 9 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

export function apply(ctx: Context, config: Config = {}): void {
  ctx.llm.registerAdapter([PROVIDER], new ScriptedAdapter(config))
}
