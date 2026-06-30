#!/usr/bin/env node
import { createInterface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { accepted, notReady, rejected, validateVoiceReadinessResponse, type TranscriptRequest, type VoiceLifecycleStatus, type VoiceReadinessResponse } from "../protocol/voice.js"
import { createManualTextCaptureProvider, createStdinTextCaptureProvider, type AudioCaptureProvider } from "./audio.js"
import { ManualTranscriptProvider, type TranscriptionProvider } from "./transcription.js"

export type BridgeConfig = {
  endpoint: string
  token: string
  action?: TranscriptRequest["action"]
  confirmFirstSubmit?: boolean
}

export type BridgeResult = { ok: true; submitted: boolean } | { ok: false; error: string }

export type ReadinessCheckOptions = {
  timeoutMs?: number
  fetch?: typeof fetch
}

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

export async function checkPluginReadiness(config: BridgeConfig, options: ReadinessCheckOptions = {}): Promise<VoiceReadinessResponse> {
  const endpoint = config.endpoint.replace(/\/$/, "")
  if (!config.token.trim()) {
    return notReady({ code: "missing_token", message: "VOICE_ORCHESTRATOR_TOKEN is required for bridge readiness." }, endpoint)
  }

  const timeoutMs = options.timeoutMs ?? 2000
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await (options.fetch ?? fetch)(`${endpoint}/v1/ready`, {
      method: "GET",
      headers: { authorization: `Bearer ${config.token}` },
      signal: controller.signal
    })

    if (response.status === 401) {
      return notReady({ code: "token_mismatch", message: "Bridge token does not match the plugin token." }, endpoint)
    }

    if (!response.ok) {
      return notReady({ code: "plugin_unavailable", message: `Plugin readiness endpoint returned HTTP ${response.status}.` }, endpoint)
    }

    const body = await response.json().catch(() => undefined)
    const validation = validateVoiceReadinessResponse(body)
    if (!validation.ok) {
      return notReady({ code: "plugin_unavailable", message: `Plugin readiness response was invalid: ${validation.error}.` }, endpoint)
    }

    return validation.value
  } catch (error) {
    return notReady(mapReadinessError(error, timeoutMs), endpoint)
  } finally {
    clearTimeout(timeout)
  }
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

  const config = { endpoint: `http://127.0.0.1:${port}`, token }
  const readiness = await checkPluginReadiness(config)
  if (!readiness.ok) {
    console.error(formatReadinessDiagnostics(readiness))
    process.exitCode = 1
  } else {
    const audio = text ? createManualTextCaptureProvider(text) : createStdinTextCaptureProvider()
    const result = await runVoiceBridge({ audio, transcription: new ManualTranscriptProvider(), config })
    if (!result.ok) {
      console.error(result.error)
      process.exitCode = 1
    }
  }
}

function mapReadinessError(error: unknown, timeoutMs: number) {
  if (error instanceof Error && error.name === "AbortError") return { code: "timeout" as const, message: `Timed out after ${timeoutMs}ms while checking plugin readiness.` }

  const code = findErrorCode(error)
  if (code === "ECONNREFUSED") return { code: "connection_refused" as const, message: "Connection refused while checking plugin readiness. Is OpenCode running with the plugin loaded?" }

  return { code: "plugin_unavailable" as const, message: "Plugin readiness endpoint could not be reached." }
}

function findErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined
  const record = error as { code?: unknown; cause?: unknown }
  if (typeof record.code === "string") return record.code
  return findErrorCode(record.cause)
}

function formatReadinessDiagnostics(readiness: VoiceReadinessResponse) {
  const endpoint = readiness.endpoint ? ` (${readiness.endpoint})` : ""
  return readiness.diagnostics.map((diagnostic) => `Voice plugin readiness failed${endpoint}: ${diagnostic.code} - ${diagnostic.message}`).join("\n")
}
