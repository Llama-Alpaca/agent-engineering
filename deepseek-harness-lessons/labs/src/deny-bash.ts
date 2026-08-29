/**
 * Lab 5: a policy gate on the real tool pipeline (official permission-gate
 * pattern from docs/cookbook/extension-cookbook.md). It denies every bash
 * call; every other tool falls through to the next listener.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

export const name = 'lab-deny-bash'

export function apply(ctx: Context): void {
  ctx.on('tools/pre-execute', async (exec: ToolExecution, next): Promise<PreToolDecision> => {
    if (exec.name === 'bash') {
      return { kind: 'deny', reason: 'Lab 5: bash is denied by the policy gate plugin.' }
    }
    return next()
  })
}
