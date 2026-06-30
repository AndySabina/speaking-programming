import { describe, expect, it } from "vitest"
import { accepted, notReady, ready, rejected, validateTranscriptRequest, validateVoiceReadinessResponse, validateVoiceStatusRequest } from "../src/protocol/voice.js"

describe("voice transcript protocol", () => {
  it("accepts and normalizes a valid transcript request", () => {
    const result = validateTranscriptRequest({
      id: "  turn-1  ",
      text: "  Run the verification  ",
      final: true,
      action: "submit",
      confidence: 0.92
    })

    expect(result).toEqual({
      ok: true,
      value: {
        id: "turn-1",
        text: "Run the verification",
        final: true,
        action: "submit",
        confidence: 0.92
      }
    })
  })

  it("rejects empty transcript text before orchestration", () => {
    const result = validateTranscriptRequest({ id: "turn-1", text: "  ", final: true, action: "submit" })

    expect(result).toEqual({ ok: false, error: "text must not be empty" })
  })

  it("rejects unsupported transcript actions", () => {
    const result = validateTranscriptRequest({ id: "turn-1", text: "hello", final: true, action: "speak" })

    expect(result).toEqual({ ok: false, error: "action must be append, submit, or command" })
  })

  it("creates stable API responses", () => {
    expect(accepted()).toEqual({ ok: true, status: "accepted", message: "transcript accepted" })
    expect(rejected("missing token")).toEqual({ ok: false, status: "rejected", message: "missing token" })
  })

  it("validates lifecycle status updates", () => {
    expect(validateVoiceStatusRequest({ id: "status-1", status: "listening" })).toEqual({ ok: true, value: { id: "status-1", status: "listening" } })
    expect(validateVoiceStatusRequest({ id: "status-2", status: "thinking" })).toEqual({
      ok: false,
      error: "status must be listening, transcribing, submitted, running, done, or error"
    })
  })

  it("creates and validates token-safe readiness diagnostics", () => {
    expect(ready("http://127.0.0.1:47737")).toEqual({ ok: true, status: "ready", endpoint: "http://127.0.0.1:47737", diagnostics: [] })

    const missingToken = notReady({ code: "missing_token", message: "VOICE_ORCHESTRATOR_TOKEN is required." }, "http://127.0.0.1:47737")

    expect(validateVoiceReadinessResponse(missingToken)).toEqual({ ok: true, value: missingToken })
    expect(JSON.stringify(missingToken)).not.toContain("secret")
  })
})
