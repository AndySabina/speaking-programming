#!/usr/bin/env node
import { createInterface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { accepted, rejected, type TranscriptRequest, type VoiceLifecycleStatus } from "../protocol/voice.js"
import { createManualTextCaptureProvider, createStdinTextCaptureProvider, type AudioCaptureProvider } from "./audio.js"
import { ManualTranscriptProvider, type TranscriptionProvider } from "./transcription.js"

export type BridgeConfig = {
  endpoint: string
  token: string
  action?: TranscriptRequest["action"]
  confirmFirstSubmit?: boolean
}

export type BridgeResult = { ok: true; submitted: boolean } | { ok: false; error: string }

export type VoiceBridge = {
  audio: AudioCaptureProvider
  transcription: TranscriptionProvider
  config: BridgeConfig
  confirm?: (text: string) => Promise<boolean>
  status?: (status: VoiceLifecycleStatus, message?: string) => Promise<void>
}

export function buildTranscriptRequest(input: { id: string; text: string; action?: TranscriptRequest["action"]; confidence?: number }): TranscriptRequest {
  return {
    id: input.id.trim(),
    text: input.text.trim(),
    final: true,
    action: input.action ?? "submit",
    confidence: input.confidence
  }
}

export async function deliverTranscript(config: BridgeConfig, request: TranscriptRequest) {
  const response = await fetch(`${config.endpoint.replace(/\/$/, "")}/v1/transcript`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
    body: JSON.stringify(request)
  })
  const body = (await response.json()) as unknown
  if (!response.ok) return rejected(`plugin rejected transcript: ${JSON.stringify(body)}`)
  return accepted("transcript delivered")
}

export async function deliverStatus(config: BridgeConfig, status: VoiceLifecycleStatus, message?: string) {
  await fetch(`${config.endpoint.replace(/\/$/, "")}/v1/status`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
    body: JSON.stringify({ id: `status-${Date.now()}`, status, message })
  }).catch(() => undefined)
}

export async function runVoiceBridge({ audio, transcription, config, confirm = confirmOnTerminal, status = (next, message) => deliverStatus(config, next, message) }: VoiceBridge): Promise<BridgeResult> {
  try {
    await status("listening")
    const capture = await audio.capture()
    await status("transcribing")
    const transcript = await transcription.transcribe(capture)
    const request = buildTranscriptRequest({ id: transcript.id, text: transcript.text, action: config.action, confidence: transcript.confidence })

    if (!request.text) {
      await status("error", "Transcript was empty.")
      return { ok: false, error: "transcript text must not be empty" }
    }

    if (request.action === "submit" && config.confirmFirstSubmit !== false) {
      const confirmed = await confirm(request.text)
      if (!confirmed) {
        await status("done", "Voice submission canceled.")
        return { ok: true, submitted: false }
      }
    }

    await status("submitted")
    const delivered = await deliverTranscript(config, request)
    if (!delivered.ok) {
      await status("error", delivered.message)
      return { ok: false, error: delivered.message }
    }

    await status("running")
    await status("done")
    return { ok: true, submitted: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : "voice bridge failed"
    await status("error", message)
    return { ok: false, error: message }
  }
}

async function confirmOnTerminal(text: string) {
  const rl = createInterface({ input, output })
  try {
    const answer = await rl.question(`Submit transcript to OpenCode?\n${text}\n[y/N] `)
    return ["y", "yes"].includes(answer.trim().toLowerCase())
  } finally {
    rl.close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const textIndex = args.indexOf("--text")
  const text = textIndex >= 0 ? args.slice(textIndex + 1).join(" ") : undefined
  const port = process.env.VOICE_ORCHESTRATOR_PORT ?? "47737"
  const token = process.env.VOICE_ORCHESTRATOR_TOKEN ?? ""

  if (!token) {
    console.error("VOICE_ORCHESTRATOR_TOKEN is required.")
    process.exitCode = 1
  } else {
    const audio = text ? createManualTextCaptureProvider(text) : createStdinTextCaptureProvider()
    const result = await runVoiceBridge({ audio, transcription: new ManualTranscriptProvider(), config: { endpoint: `http://127.0.0.1:${port}`, token } })
    if (!result.ok) {
      console.error(result.error)
      process.exitCode = 1
    }
  }
}
