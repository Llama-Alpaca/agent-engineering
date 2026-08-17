import { strict as nodeAssert } from "node:assert"
import { Context } from "../code.ts"

const ctx = new Context()
const events: string[] = []
const observer = ctx.inject("observer", ["svc"], (runtime, fiber) => {
  runtime.on("x", () => events.push("x"), fiber)
})
nodeAssert.equal(observer.active, false)
const provider = ctx.install("provider", (runtime, fiber) => {
  runtime.provide("svc", { ok: true }, fiber)
})
nodeAssert.equal(observer.active, true)
await ctx.emit("x", undefined)
nodeAssert.deepEqual(events, ["x"])
provider.dispose()
nodeAssert.equal(observer.active, false)
nodeAssert.equal(ctx.resources.listeners, 0)
const fiber = ctx.install("dispatch", (runtime, owner) => {
  runtime.on("w", async (value, next) => next?.(`${String(value)}!`), owner)
})
const result = await ctx.waterfall("w", "ok")
nodeAssert.equal(result.shortCircuited, false)
fiber.dispose()
nodeAssert.equal(ctx.resources.listeners, 0)

const shortFiber = ctx.install("short", (runtime, owner) => {
  runtime.on("short", async (value, next) => next?.(`${String(value)}!`), owner)
  runtime.on("short", () => "blocked", owner)
})
const short = await ctx.waterfall("short", "request")
nodeAssert.equal(short.shortCircuited, true)
await nodeAssert.rejects(() => ctx.strictWaterfall("short", "request"), /did not call next/)
shortFiber.dispose()
nodeAssert.equal(ctx.resources.listeners, 0)
console.log("L01 tests: ok")
