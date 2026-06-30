import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import * as pluginModule from "../.opencode/plugin/voice-orchestrator.js"
import { createLocalBootstrapSession, readLocalBootstrapSession } from "../src/voice-orchestrator/bootstrap.js"
import { applyTranscriptAction, startVoiceOrchestratorServer } from "../src/voice-orchestrator/server.js"

function createTuiClient() {
  return {
    appendPrompt: vi.fn(async () => true),
    submitPrompt: vi.fn(async () => true),
    executeCommand: vi.fn(async () => true),
    showToast: vi.fn(async () => true)
  }
}

describe("voice orchestrator plugin export contract", () => {
  it("exports only the default OpenCode plugin function from the configured entry module", () => {
    expect(Object.keys(pluginModule)).toEqual(["default"])
    expect(pluginModule.default).toEqual(expect.any(Function))
  })
})

describe("voice orchestrator local bootstrap", () => {
  it("creates a token-safe localhost session file without requiring an env token", () => {
    const bootstrapFile = join(mkdtempSync(join(tmpdir(), "voice-bootstrap-")), "session.json")

    const session = createLocalBootstrapSession({ port: 47737, bootstrapFile, now: new Date("2026-06-30T00:00:00.000Z") })
    const persisted = JSON.parse(readFileSync(bootstrapFile, "utf8"))

    expect(session.endpoint).toBe("http://127.0.0.1:47737")
    expect(session.token).toEqual(expect.any(String))
    expect(session.token.length).toBeGreaterThan(32)
    expect(persisted).toMatchObject({ endpoint: "http://127.0.0.1:47737", port: 47737, createdAt: "2026-06-30T00:00:00.000Z" })
    expect(JSON.stringify({ endpoint: persisted.endpoint, port: persisted.port, createdAt: persisted.createdAt })).not.toContain(session.token)
  })

  it("reads only localhost bootstrap sessions", () => {
    const bootstrapFile = join(mkdtempSync(join(tmpdir(), "voice-bootstrap-")), "session.json")
    createLocalBootstrapSession({ port: 47737, token: "local-token", bootstrapFile })

    expect(readLocalBootstrapSession(bootstrapFile)).toMatchObject({ endpoint: "http://127.0.0.1:47737", token: "local-token" })

    const remoteBootstrapFile = join(mkdtempSync(join(tmpdir(), "voice-bootstrap-")), "session.json")
    writeFileSync(remoteBootstrapFile, JSON.stringify({ endpoint: "https://example.com:47737", token: "remote-token", port: 47737, pid: 1, createdAt: "2026-06-30T00:00:00.000Z" }))

    expect(readLocalBootstrapSession(remoteBootstrapFile)).toBeUndefined()
  })
})

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

  it("reports authenticated readiness with token-safe endpoint metadata", async () => {
    const tui = createTuiClient()
    const server = startVoiceOrchestratorServer({ port: 0, token: "secret", tui })
    servers.push(server)
    const url = (await serverUrl(server)).replace("/v1/transcript", "/v1/ready")

    const response = await fetch(url, { headers: { authorization: "Bearer secret" } })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ ok: true, status: "ready", endpoint: url.replace("/v1/ready", ""), diagnostics: [] })
    expect(JSON.stringify(body)).not.toContain("secret")
    expect(tui.showToast).not.toHaveBeenCalled()
  })

  it("rejects unauthenticated readiness checks with token-safe diagnostics", async () => {
    const tui = createTuiClient()
    const server = startVoiceOrchestratorServer({ port: 0, token: "secret", tui })
    servers.push(server)
    const url = (await serverUrl(server)).replace("/v1/transcript", "/v1/ready")

    const response = await fetch(url)
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toEqual({
      ok: false,
      status: "not_ready",
      endpoint: url.replace("/v1/ready", ""),
      diagnostics: [{ code: "token_mismatch", message: "Missing or invalid bearer token." }]
    })
    expect(JSON.stringify(body)).not.toContain("secret")
    expect(tui.showToast).not.toHaveBeenCalled()
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
