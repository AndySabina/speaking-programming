import { afterEach, describe, expect, it, vi } from "vitest"
import { applyTranscriptAction, startVoiceOrchestratorServer } from "../.opencode/plugin/voice-orchestrator.js"

function createTuiClient() {
  return {
    appendPrompt: vi.fn(async () => true),
    submitPrompt: vi.fn(async () => true),
    executeCommand: vi.fn(async () => true),
    showToast: vi.fn(async () => true)
  }
}

describe("voice orchestrator action mapping", () => {
  it("appends transcript text without submitting", async () => {
    const tui = createTuiClient()

    await expect(applyTranscriptAction(tui, { id: "turn-1", text: "Explain this diff", final: false, action: "append" })).resolves.toEqual({
      ok: true,
      status: "accepted",
      message: "transcript appended"
    })

    expect(tui.appendPrompt).toHaveBeenCalledWith({ body: { text: "Explain this diff" } })
    expect(tui.submitPrompt).not.toHaveBeenCalled()
  })

  it("submits transcript text through the TUI prompt flow", async () => {
    const tui = createTuiClient()

    await applyTranscriptAction(tui, { id: "turn-2", text: "Run validation", final: true, action: "submit" })

    expect(tui.appendPrompt).toHaveBeenCalledWith({ body: { text: "Run validation" } })
    expect(tui.submitPrompt).toHaveBeenCalledOnce()
    expect(tui.showToast).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ title: "OpenCode running" }) }))
  })

  it("allows only explicit OpenCode command mappings", async () => {
    const tui = createTuiClient()

    await expect(applyTranscriptAction(tui, { id: "turn-3", text: "session.interrupt", final: true, action: "command" })).resolves.toEqual({
      ok: true,
      status: "accepted",
      message: "command executed"
    })

    await expect(applyTranscriptAction(tui, { id: "turn-4", text: "shell.rm", final: true, action: "command" })).resolves.toEqual({
      ok: false,
      status: "rejected",
      message: "unsupported command"
    })
    expect(tui.executeCommand).toHaveBeenCalledTimes(1)
  })
})

describe("voice orchestrator HTTP adapter", () => {
  const servers: ReturnType<typeof startVoiceOrchestratorServer>[] = []

  afterEach(async () => {
    await Promise.all(servers.map((server) => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))))
    servers.length = 0
  })

  it("rejects unauthenticated transcript requests", async () => {
    const tui = createTuiClient()
    const server = startVoiceOrchestratorServer({ port: 0, token: "secret", tui })
    servers.push(server)
    const url = await serverUrl(server)

    const response = await fetch(url, { method: "POST", body: JSON.stringify({ id: "turn-1", text: "hello", final: true, action: "submit" }) })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ ok: false, status: "rejected", message: "unauthorized" })
    expect(tui.appendPrompt).not.toHaveBeenCalled()
  })

  it("accepts authenticated transcript requests and validates actions", async () => {
    const tui = createTuiClient()
    const server = startVoiceOrchestratorServer({ port: 0, token: "secret", tui })
    servers.push(server)
    const url = await serverUrl(server)

    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer secret", "content-type": "application/json" },
      body: JSON.stringify({ id: "turn-1", text: "Run validation", final: true, action: "submit" })
    })

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({ ok: true, status: "accepted", message: "transcript submitted" })
    expect(tui.appendPrompt).toHaveBeenCalledWith({ body: { text: "Run validation" } })
    expect(tui.submitPrompt).toHaveBeenCalledOnce()
  })

  it("accepts lifecycle status updates without exposing transcript text", async () => {
    const tui = createTuiClient()
    const server = startVoiceOrchestratorServer({ port: 0, token: "secret", tui })
    servers.push(server)
    const url = (await serverUrl(server)).replace("/v1/transcript", "/v1/status")

    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer secret", "content-type": "application/json" },
      body: JSON.stringify({ id: "status-1", status: "listening" })
    })

    expect(response.status).toBe(202)
    expect(tui.showToast).toHaveBeenCalledWith({
      body: expect.objectContaining({ title: "Voice listening", message: "Listening for dictated instruction." })
    })
  })
})

function serverUrl(server: ReturnType<typeof startVoiceOrchestratorServer>) {
  const address = server.address()
  if (typeof address === "object" && address) return Promise.resolve(`http://127.0.0.1:${address.port}/v1/transcript`)

  return new Promise<string>((resolve) => {
    server.on("listening", () => {
      const address = server.address()
      if (typeof address === "object" && address) resolve(`http://127.0.0.1:${address.port}/v1/transcript`)
    })
  })
}
