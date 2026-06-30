import { describe, expect, it, vi } from "vitest"
import { buildTranscriptRequest, checkPluginReadiness, runVoiceBridge } from "../src/voice-bridge/index.js"
import { createManualTextCaptureProvider } from "../src/voice-bridge/audio.js"
import { ManualTranscriptProvider, UnavailableTranscriptionProvider } from "../src/voice-bridge/transcription.js"

describe("voice bridge request building", () => {
  it("normalizes transcript requests for plugin delivery", () => {
    expect(buildTranscriptRequest({ id: " turn-1 ", text: "  Run validate  " })).toEqual({
      id: "turn-1",
      text: "Run validate",
      final: true,
      action: "submit",
      confidence: undefined
    })
  })
})

describe("voice bridge readiness preflight", () => {
  it("reports success when the plugin readiness endpoint is reachable", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, status: "ready", endpoint: "http://127.0.0.1:47737", diagnostics: [] }), { status: 200 }))

    await expect(checkPluginReadiness({ endpoint: "http://127.0.0.1:47737", token: "secret" }, { fetch })).resolves.toEqual({
      ok: true,
      status: "ready",
      endpoint: "http://127.0.0.1:47737",
      diagnostics: []
    })
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:47737/v1/ready",
      expect.objectContaining({ method: "GET", headers: { authorization: "Bearer secret" } })
    )
  })

  it("diagnoses a missing bridge token without calling the plugin", async () => {
    const fetch = vi.fn()

    await expect(checkPluginReadiness({ endpoint: "http://127.0.0.1:47737", token: "" }, { fetch })).resolves.toMatchObject({
      ok: false,
      status: "not_ready",
      diagnostics: [{ code: "missing_token" }]
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it("diagnoses token mismatch without exposing token values", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: false, status: "not_ready", endpoint: "http://127.0.0.1:47737", diagnostics: [{ code: "token_mismatch", message: "Missing or invalid bearer token." }] }), { status: 401 }))

    const readiness = await checkPluginReadiness({ endpoint: "http://127.0.0.1:47737", token: "wrong-secret" }, { fetch })

    expect(readiness).toMatchObject({ ok: false, diagnostics: [{ code: "token_mismatch" }] })
    expect(JSON.stringify(readiness)).not.toContain("wrong-secret")
  })

  it("diagnoses stale or incompatible plugin endpoints", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: false, status: "rejected", message: "route not found" }), { status: 404 }))

    await expect(checkPluginReadiness({ endpoint: "http://127.0.0.1:47737", token: "secret" }, { fetch })).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "plugin_unavailable" }]
    })
  })

  it("diagnoses connection refused", async () => {
    const fetch = vi.fn(async () => {
      const error = new TypeError("fetch failed") as TypeError & { cause?: { code: string } }
      error.cause = { code: "ECONNREFUSED" }
      throw error
    })

    await expect(checkPluginReadiness({ endpoint: "http://127.0.0.1:47737", token: "secret" }, { fetch })).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "connection_refused" }]
    })
  })

  it("diagnoses readiness timeout", async () => {
    const fetch = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")))
      })
    })

    await expect(checkPluginReadiness({ endpoint: "http://127.0.0.1:47737", token: "secret" }, { fetch, timeoutMs: 1 })).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "timeout" }]
    })
  })
})

describe("voice bridge provider flow", () => {
  it("confirms a manual transcript before delivery", async () => {
    const status = vi.fn(async () => undefined)
    const confirm = vi.fn(async () => false)

    const result = await runVoiceBridge({
      audio: createManualTextCaptureProvider("Run validation", "turn-1"),
      transcription: new ManualTranscriptProvider(),
      config: { endpoint: "http://127.0.0.1:1", token: "secret" },
      confirm,
      status
    })

    expect(result).toEqual({ ok: true, submitted: false })
    expect(confirm).toHaveBeenCalledWith("Run validation")
    expect(status).toHaveBeenNthCalledWith(1, "listening")
    expect(status).toHaveBeenNthCalledWith(2, "transcribing")
    expect(status).toHaveBeenLastCalledWith("done", "Voice submission canceled.")
  })

  it("reports empty transcripts without contacting the plugin", async () => {
    const status = vi.fn(async () => undefined)
    const confirm = vi.fn(async () => true)

    const result = await runVoiceBridge({
      audio: createManualTextCaptureProvider("   ", "turn-2"),
      transcription: new ManualTranscriptProvider(),
      config: { endpoint: "http://127.0.0.1:1", token: "secret" },
      confirm,
      status
    })

    expect(result).toEqual({ ok: false, error: "transcript text must not be empty" })
    expect(confirm).not.toHaveBeenCalled()
    expect(status).toHaveBeenLastCalledWith("error", "Transcript was empty.")
  })

  it("surfaces unavailable transcription providers", async () => {
    const status = vi.fn(async () => undefined)

    const result = await runVoiceBridge({
      audio: createManualTextCaptureProvider("Run validation", "turn-3"),
      transcription: new UnavailableTranscriptionProvider("test-stt"),
      config: { endpoint: "http://127.0.0.1:1", token: "secret" },
      status
    })

    expect(result).toEqual({ ok: false, error: "test-stt transcription provider is unavailable" })
    expect(status).toHaveBeenLastCalledWith("error", "test-stt transcription provider is unavailable")
  })
})
