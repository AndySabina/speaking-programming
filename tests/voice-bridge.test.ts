import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { buildTranscriptRequest, checkPluginReadiness, resolveBridgeConfig, runVoiceBridge, selectVoiceProviders } from "../src/voice-bridge/index.js"
import { createAudioFileCaptureProvider, createCommandAudioCaptureProvider, createManualTextCaptureProvider } from "../src/voice-bridge/audio.js"
import { CommandTranscriptionProvider, ManualTranscriptProvider, UnavailableTranscriptionProvider } from "../src/voice-bridge/transcription.js"

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
  it("resolves localhost auth from the plugin bootstrap session when env token is absent", () => {
    const bootstrapFile = join(mkdtempSync(join(tmpdir(), "voice-bridge-bootstrap-")), "session.json")
    const previousBootstrapFile = process.env.VOICE_ORCHESTRATOR_BOOTSTRAP_FILE
    const previousEndpoint = process.env.VOICE_ORCHESTRATOR_ENDPOINT
    const previousToken = process.env.VOICE_ORCHESTRATOR_TOKEN

    process.env.VOICE_ORCHESTRATOR_BOOTSTRAP_FILE = bootstrapFile
    delete process.env.VOICE_ORCHESTRATOR_ENDPOINT
    delete process.env.VOICE_ORCHESTRATOR_TOKEN
    writeFileSync(bootstrapFile, JSON.stringify({ endpoint: "http://127.0.0.1:47737", token: "bootstrap-token", port: 47737, pid: 1, createdAt: "2026-06-30T00:00:00.000Z" }))

    try {
      expect(resolveBridgeConfig()).toEqual({ endpoint: "http://127.0.0.1:47737", token: "bootstrap-token" })
    } finally {
      restoreEnv("VOICE_ORCHESTRATOR_BOOTSTRAP_FILE", previousBootstrapFile)
      restoreEnv("VOICE_ORCHESTRATOR_ENDPOINT", previousEndpoint)
      restoreEnv("VOICE_ORCHESTRATOR_TOKEN", previousToken)
    }
  })

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

  it("diagnoses a missing bootstrap session without making manual token setup the primary path", async () => {
    const fetch = vi.fn()

    const readiness = await checkPluginReadiness({ endpoint: "http://127.0.0.1:47737", token: "" }, { fetch })

    expect(readiness).toMatchObject({
      ok: false,
      status: "not_ready",
      diagnostics: [{ code: "missing_token" }]
    })
    expect(readiness.diagnostics[0]?.message).toContain("Start or restart OpenCode")
    expect(readiness.diagnostics[0]?.message).toContain("bootstrap localhost auth")
    expect(readiness.diagnostics[0]?.message).toContain("advanced compatibility override")
    expect(readiness.diagnostics[0]?.message).not.toMatch(/^VOICE_ORCHESTRATOR_TOKEN is required/)
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

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = value
}

describe("voice bridge provider flow", () => {
  it("selects command STT for an existing audio file without requiring recorder config", async () => {
    const selection = selectVoiceProviders({ audioFile: "/tmp/sample.wav", sttProvider: "command", sttCommand: "printf transcript" })

    await expect(selection.audio.capture()).resolves.toMatchObject({ audioFile: "/tmp/sample.wav" })
    expect(selection.providerName).toBe("command")
  })

  it("requires a command STT adapter before using command audio capture", () => {
    expect(() => selectVoiceProviders({ sttProvider: "command", recorderCommand: "arecord -d 3 -f cd {output}" })).toThrow("VOICE_STT_COMMAND is required")
  })

  it("requires a recorder command for live command voice capture", () => {
    expect(() => selectVoiceProviders({ sttProvider: "command", sttCommand: "whisper-cli {file}" })).toThrow("VOICE_RECORDER_COMMAND is required")
  })

  it("rejects unsupported STT providers with token-safe diagnostics", () => {
    expect(() => selectVoiceProviders({ sttProvider: "cloud-secret-provider", sttCommand: "secret" })).toThrow("unsupported STT provider: cloud-secret-provider")
  })

  it("captures audio through a command provider and passes the file to command STT", async () => {
    const audio = createCommandAudioCaptureProvider({ command: "node -e \"require('fs').writeFileSync(process.env.VOICE_AUDIO_FILE, 'audio')\"", id: "turn-command" })
    const transcription = new CommandTranscriptionProvider("node -e \"process.stdout.write(process.env.VOICE_AUDIO_FILE.endsWith('capture.wav') ? 'Run validation' : '')\"")

    const capture = await audio.capture()

    expect(capture).toMatchObject({ id: "turn-command" })
    expect(capture.internallyCreatedAudioFile).toBe(true)
    await expect(transcription.transcribe(capture)).resolves.toEqual({ id: "turn-command", text: "Run validation" })
  })

  it("transcribes an explicit audio file with a command provider", async () => {
    const audio = createAudioFileCaptureProvider("/tmp/voice.wav", "turn-file")
    const transcription = new CommandTranscriptionProvider("node -e \"process.stdout.write(process.env.VOICE_AUDIO_FILE === '/tmp/voice.wav' ? 'Explain this diff' : '')\"")

    await expect(transcription.transcribe(await audio.capture())).resolves.toEqual({ id: "turn-file", text: "Explain this diff" })
  })

  it("removes internally captured audio after successful delivery", async () => {
    const audio = createCommandAudioCaptureProvider({ command: "node -e \"require('fs').writeFileSync(process.env.VOICE_AUDIO_FILE, 'audio')\"", id: "turn-cleanup-success" })
    let capturedAudioFile = ""
    const transcription = {
      async transcribe(capture: { id: string; audioFile?: string }) {
        capturedAudioFile = capture.audioFile ?? ""
        expect(existsSync(capturedAudioFile)).toBe(true)
        return { id: capture.id, text: "Run validation" }
      }
    }
    const previousFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch

    try {
      await expect(
        runVoiceBridge({
          audio,
          transcription,
          config: { endpoint: "http://127.0.0.1:47737", token: "secret", confirmFirstSubmit: false },
          status: vi.fn(async () => undefined)
        })
      ).resolves.toEqual({ ok: true, submitted: true })
      expect(capturedAudioFile).toContain("capture.wav")
      expect(existsSync(capturedAudioFile)).toBe(false)
    } finally {
      globalThis.fetch = previousFetch
    }
  })

  it("removes internally captured audio when transcription fails", async () => {
    const audio = createCommandAudioCaptureProvider({ command: "node -e \"require('fs').writeFileSync(process.env.VOICE_AUDIO_FILE, 'audio')\"", id: "turn-cleanup-error" })
    let capturedAudioFile = ""
    const transcription = {
      async transcribe(capture: { audioFile?: string }) {
        capturedAudioFile = capture.audioFile ?? ""
        expect(existsSync(capturedAudioFile)).toBe(true)
        throw new Error("transcription failed")
      }
    }

    await expect(
      runVoiceBridge({
        audio,
        transcription,
        config: { endpoint: "http://127.0.0.1:47737", token: "secret" },
        status: vi.fn(async () => undefined)
      })
    ).resolves.toEqual({ ok: false, error: "transcription failed" })
    expect(capturedAudioFile).toContain("capture.wav")
    expect(existsSync(capturedAudioFile)).toBe(false)
  })

  it("removes internally captured audio when delivery fails", async () => {
    const audio = createCommandAudioCaptureProvider({ command: "node -e \"require('fs').writeFileSync(process.env.VOICE_AUDIO_FILE, 'audio')\"", id: "turn-cleanup-delivery-error" })
    let capturedAudioFile = ""
    const transcription = {
      async transcribe(capture: { id: string; audioFile?: string }) {
        capturedAudioFile = capture.audioFile ?? ""
        return { id: capture.id, text: "Run validation" }
      }
    }
    const previousFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: false, message: "rejected" }), { status: 500 })) as typeof fetch

    try {
      await expect(
        runVoiceBridge({
          audio,
          transcription,
          config: { endpoint: "http://127.0.0.1:47737", token: "secret", confirmFirstSubmit: false },
          status: vi.fn(async () => undefined)
        })
      ).resolves.toMatchObject({ ok: false })
      expect(capturedAudioFile).toContain("capture.wav")
      expect(existsSync(capturedAudioFile)).toBe(false)
    } finally {
      globalThis.fetch = previousFetch
    }
  })

  it("preserves explicit audio-file inputs when transcription fails", async () => {
    const audioFile = join(mkdtempSync(join(tmpdir(), "voice-user-audio-")), "sample.wav")
    writeFileSync(audioFile, "audio")
    const transcription = {
      async transcribe() {
        throw new Error("transcription failed")
      }
    }

    try {
      await expect(
        runVoiceBridge({
          audio: createAudioFileCaptureProvider(audioFile, "turn-preserve-user-audio"),
          transcription,
          config: { endpoint: "http://127.0.0.1:47737", token: "secret" },
          status: vi.fn(async () => undefined)
        })
      ).resolves.toEqual({ ok: false, error: "transcription failed" })
      expect(existsSync(audioFile)).toBe(true)
    } finally {
      rmSync(audioFile, { force: true })
    }
  })

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
