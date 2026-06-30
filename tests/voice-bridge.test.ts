import { describe, expect, it, vi } from "vitest"
import { buildTranscriptRequest, runVoiceBridge } from "../src/voice-bridge/index.js"
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
