import { assert } from "../../common/trace.ts"
import {
  CapabilityError,
  EVIDENCE,
  FILE_SYSTEM,
  SHELL,
  WORLD,
  createRealm,
} from "../code.ts"

const local = createRealm({
  id: "test-local",
  provider: "local",
  root: "/test/local",
  files: { "same.txt": "local" },
})
const remote = createRealm({
  id: "test-remote",
  provider: "remote",
  root: "/test/remote",
  files: { "same.txt": "private workspace" },
  remoteRecords: { "same.txt": "remote" },
})

const localEvidence = await local.consumer.consume(local.scope.resolve(EVIDENCE), "same.txt")
const remoteEvidence = await remote.consumer.consume(remote.scope.resolve(EVIDENCE), "same.txt")
assert(localEvidence.content === "local", "local provider content")
assert(remoteEvidence.content === "remote", "remote provider content")
assert(local.consumer.name === remote.consumer.name, "provider swap changed consumer")

const retainedRemote = remote.scope.resolve(EVIDENCE)
remote.scope.dispose()
let remoteDisposed = false
try {
  await retainedRemote.read("same.txt")
} catch (error) {
  remoteDisposed = error instanceof CapabilityError && error.code === "SCOPE_DISPOSED"
}
assert(remoteDisposed, "a resolved remote capability must be revoked after dispose")

const rootRealm = createRealm({ id: "root", provider: "local", root: "/", files: { "x.txt": "root file" } })
const rootWorld = rootRealm.scope.resolve(WORLD)
assert(await rootWorld.read("/x.txt") === "root file", "root workspace should accept an absolute child path")
rootRealm.scope.dispose()

const world = local.scope.resolve(WORLD)
assert(local.scope.resolve(FILE_SYSTEM) === world, "filesystem must share world")
assert(local.scope.resolve(SHELL) === world, "shell must share world")

let escaped = false
try {
  await world.read("../outside")
} catch (error) {
  escaped = error instanceof CapabilityError && error.code === "PATH_ESCAPE"
}
assert(escaped, "path traversal must fail closed")

let approvalRequired = false
try {
  await world.write("out.txt", "first")
} catch (error) {
  approvalRequired = error instanceof CapabilityError && error.code === "APPROVAL_REQUIRED"
}
assert(approvalRequired, "write should ask")
world.policy.approveOnce("write", "out.txt")
await world.write("out.txt", "approved")
assert(await world.read("out.txt") === "approved", "approved retry did not write")

let secondAsk = false
try {
  await world.write("out.txt", "second")
} catch (error) {
  secondAsk = error instanceof CapabilityError && error.code === "APPROVAL_REQUIRED"
}
assert(secondAsk, "one-shot approval was reused")

local.scope.dispose()
let disposed = false
try {
  local.scope.resolve(EVIDENCE)
} catch (error) {
  disposed = error instanceof CapabilityError && error.code === "SCOPE_DISPOSED"
}
assert(disposed, "disposed scope should reject resolution")

console.log("L07 tests: ok")
