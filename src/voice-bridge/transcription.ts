import type { AudioCapture } from "./audio.js"

export type Transcript = {
  id: string
  text: string
  confidence?: number
}

export type TranscriptionProvider = {
  transcribe(capture: AudioCapture): Promise<Transcript>
}

export class ManualTranscriptProvider implements TranscriptionProvider {
  async transcribe(capture: AudioCapture): Promise<Transcript> {
    if (capture.text === undefined) throw new Error("manual transcript provider requires text input")
    return { id: capture.id, text: capture.text }
  }
}

export class UnavailableTranscriptionProvider implements TranscriptionProvider {
  constructor(private readonly providerName: string) {}

  async transcribe(): Promise<Transcript> {
    throw new Error(`${this.providerName} transcription provider is unavailable`)
  }
}
