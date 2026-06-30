export const transcriptActions = ["append", "submit", "command"] as const
export const voiceLifecycleStatuses = ["listening", "transcribing", "submitted", "running", "done", "error"] as const

export type TranscriptAction = (typeof transcriptActions)[number]
export type VoiceLifecycleStatus = (typeof voiceLifecycleStatuses)[number]

export type TranscriptRequest = {
  id: string
  text: string
  final: boolean
  action: TranscriptAction
  confidence?: number
}

export type TranscriptResponse = {
  ok: boolean
  status: "accepted" | "rejected"
  message: string
}

export type VoiceStatusRequest = {
  id: string
  status: VoiceLifecycleStatus
  message?: string
}

export type ValidationResult =
  | { ok: true; value: TranscriptRequest }
  | { ok: false; error: string }

export function validateTranscriptRequest(input: unknown): ValidationResult {
  if (!isRecord(input)) return reject("request must be a JSON object")

  const id = normalizeRequiredString(input.id, "id")
  if (!id.ok) return reject(id.error)

  const text = normalizeRequiredString(input.text, "text")
  if (!text.ok) return reject(text.error)

  if (typeof input.final !== "boolean") return reject("final must be a boolean")
  if (!isTranscriptAction(input.action)) return reject("action must be append, submit, or command")

  if (input.confidence !== undefined) {
    if (typeof input.confidence !== "number" || input.confidence < 0 || input.confidence > 1) {
      return reject("confidence must be a number between 0 and 1")
    }
  }

  return {
    ok: true,
    value: {
      id: id.value,
      text: text.value,
      final: input.final,
      action: input.action,
      confidence: input.confidence
    }
  }
}

export function validateVoiceStatusRequest(input: unknown): { ok: true; value: VoiceStatusRequest } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "request must be a JSON object" }

  const id = normalizeRequiredString(input.id, "id")
  if (!id.ok) return { ok: false, error: id.error }

  if (!isVoiceLifecycleStatus(input.status)) return { ok: false, error: "status must be listening, transcribing, submitted, running, done, or error" }

  if (input.message !== undefined && typeof input.message !== "string") return { ok: false, error: "message must be a string" }

  return { ok: true, value: { id: id.value, status: input.status, message: input.message?.trim() || undefined } }
}

export function accepted(message = "transcript accepted"): TranscriptResponse {
  return { ok: true, status: "accepted", message }
}

export function rejected(message: string): TranscriptResponse {
  return { ok: false, status: "rejected", message }
}

function isTranscriptAction(value: unknown): value is TranscriptAction {
  return typeof value === "string" && transcriptActions.includes(value as TranscriptAction)
}

function isVoiceLifecycleStatus(value: unknown): value is VoiceLifecycleStatus {
  return typeof value === "string" && voiceLifecycleStatuses.includes(value as VoiceLifecycleStatus)
}

function normalizeRequiredString(value: unknown, field: string) {
  if (typeof value !== "string") return { ok: false as const, error: `${field} must be a string` }
  const trimmed = value.trim()
  if (trimmed.length === 0) return { ok: false as const, error: `${field} must not be empty` }
  return { ok: true as const, value: trimmed }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function reject(error: string): ValidationResult {
  return { ok: false, error }
}
