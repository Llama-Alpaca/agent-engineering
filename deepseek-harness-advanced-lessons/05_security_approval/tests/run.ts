import { strict as nodeAssert } from "node:assert"
import {
  ApprovalService,
  PermissionPresetService,
  SessionLog,
  evaluateSandboxEvidence,
  runSecurityLab,
  validateApprovalAudit,
} from "../code.ts"

const facts = await runSecurityLab()
nodeAssert.equal(facts.allowed, "allowed-once")
nodeAssert.equal(facts.rejected, "rejected")
nodeAssert.equal(facts.unavailable, "unavailable")
nodeAssert.deepEqual(facts.auditErrors, [])
nodeAssert.equal(facts.currentPreset, "danger-full-access")
nodeAssert.equal((facts.linux as Record<string, unknown>).runner, "landlock")
nodeAssert.equal((facts.linux as Record<string, unknown>).enforcement, "partial")
nodeAssert.equal((facts.windows as Record<string, unknown>).enforcement, "partial")
nodeAssert.equal((facts.unavailableSandbox as Record<string, unknown>).confined, false)

const idle = new SessionLog()
const idleApproval = new ApprovalService(idle, { answerer: () => "allowed-once" })
await nodeAssert.rejects(idleApproval.request({ toolName: "write" }), /open turn/)
nodeAssert.deepEqual(idle.events, [], "idle rejection must append no crash-tail audit")

const throwing = new SessionLog()
throwing.append({ type: "turn/start", data: { turn: 1 } })
const throwingApproval = new ApprovalService(throwing, { answerer: () => { throw new Error("UI failed") } })
nodeAssert.equal(await throwingApproval.request({ toolName: "write" }), "unavailable")
nodeAssert.deepEqual(validateApprovalAudit(throwing.events), [])

const rogue = new SessionLog()
rogue.append({ type: "turn/start", data: { turn: 1 } })
nodeAssert.equal(await new ApprovalService(rogue, { answerer: () => "yes" }).request({ toolName: "write" }), "unavailable")

const cancelled = new SessionLog()
cancelled.append({ type: "turn/start", data: { turn: 1 } })
const controller = new AbortController()
controller.abort()
nodeAssert.equal(await new ApprovalService(cancelled, { answerer: () => "allowed-once" }).request({ toolName: "write", signal: controller.signal }), "cancelled")

const presetLog = new SessionLog()
const presetApproval = new ApprovalService(presetLog)
const presets = new PermissionPresetService(presetLog, presetApproval)
presets.set("workspace-write")
nodeAssert.equal(presetLog.events.length, 0, "selecting the effective preset again must append nothing")
presets.set("danger-full-access")
nodeAssert.deepEqual(presetLog.events.map((event) => event.type), ["permission/preset", "sandbox/mode", "approval/policy"])

const brokenAudit = new SessionLog()
brokenAudit.append({ type: "approval/decided", data: { id: "missing", outcome: "allowed-once" } })
nodeAssert.ok(validateApprovalAudit(brokenAudit.events).some((error) => error.includes("without a matching ask")))

nodeAssert.equal(evaluateSandboxEvidence({ platform: "linux", available: ["bwrap"], probe: { bwrap: false } }).confined, false)

console.log("advanced L05 tests: ok")
