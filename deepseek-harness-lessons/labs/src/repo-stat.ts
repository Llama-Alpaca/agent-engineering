/**
 * Lab 3: a real model-facing tool — structured git state as canonical JSON.
 * value/render split: execute returns durable data, render projects it
 * into model-facing content.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

const run = promisify(execFile)

export const name = 'lab-repo-stat'
export const inject = ['tools']

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'repo_stat',
    description: 'Report the git state of a working directory: current HEAD commit and porcelain status entries.',
    parameters: {
      path: { type: 'string', description: 'Working directory to inspect; defaults to the session workspace.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const cwd = args.path ?? process.cwd()
      const [head, status] = await Promise.all([
        run('git', ['rev-parse', '--short', 'HEAD'], { cwd, signal: exec.signal }),
        run('git', ['status', '--porcelain'], { cwd, signal: exec.signal }),
      ])
      const dirty = status.stdout.split('\n').filter((line) => line.trim().length > 0)
      return { head: head.stdout.trim(), dirtyCount: dirty.length, dirty: dirty.slice(0, 20) }
    },
  }))
}
