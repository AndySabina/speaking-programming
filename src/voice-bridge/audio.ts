import { readFileSync } from "node:fs"

export type AudioCapture = {
  id: string
  text?: string
  audio?: Uint8Array
}

export type AudioCaptureProvider = {
  capture(): Promise<AudioCapture>
}

export function createManualTextCaptureProvider(text: string, id = createTurnId()): AudioCaptureProvider {
  return {
    async capture() {
      return { id, text }
    }
  }
}

export function createStdinTextCaptureProvider(id = createTurnId()): AudioCaptureProvider {
  return {
    async capture() {
      return { id, text: readFileSync(0, "utf8") }
    }
  }
}

function createTurnId() {
  return `voice-${Date.now()}`
}
