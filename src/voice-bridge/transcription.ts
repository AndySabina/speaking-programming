import type { AudioCapture } from "./audio.js"
import { spawn } from "node:child_process"

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

export class CommandTranscriptionProvider implements TranscriptionProvider {
  constructor(private readonly command: string) {}

  async transcribe(capture: AudioCapture): Promise<Transcript> {
    if (!capture.audioFile) throw new Error("command transcription provider requires an audio file")
    const text = (await runTranscriptionCommand(this.command, capture.audioFile)).trim()
    if (!text) throw new Error("command transcription provider returned an empty transcript")
    return { id: capture.id, text }
  }
}

function runTranscriptionCommand(command: string, audioFile: string) {
  const prepared = command.includes("{file}") ? command.replaceAll("{file}", shellQuote(audioFile)) : command

  return new Promise<string>((resolve, reject) => {
    const child = spawn(prepared, {
      shell: true,
      env: { ...process.env, VOICE_AUDIO_FILE: audioFile },
      stdio: ["ignore", "pipe", "ignore"]
    })

    let stdout = ""
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk)
    })
    child.on("error", () => reject(new Error("command transcription provider failed")))
    child.on("close", (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`command transcription provider failed with exit code ${code}`))
    })
  })
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}
