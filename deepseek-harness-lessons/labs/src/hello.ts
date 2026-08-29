/**
 * Lab 1: the smallest honest plugin — observe, don't change anything.
 * Diagnostics go to stderr: stdout belongs to the product's output.
 */
import type { Context } from '@deepseek-ai/cordis'

export const name = 'lab-hello'

export function apply(ctx: Context): void {
  process.stderr.write('lab-hello: plugin mounted\n')
  ctx.on('session/event', (session, event) => {
    process.stderr.write(`lab-hello: ${event.type}\n`)
  })
  ctx.on('dispose', () => process.stderr.write('lab-hello: plugin disposed\n'))
}
