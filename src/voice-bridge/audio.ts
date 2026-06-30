import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn } from "node:child_process"

export type AudioCapture = {
  id: string
  text?: string
  audioFile?: string
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

export function createAudioFileCaptureProvider(audioFile: string, id = createTurnId()): AudioCaptureProvider {
  return {
    async capture() {
      if (!audioFile.trim()) throw new Error("audio file path is required")
      return { id, audioFile }
    }
  }
}

export function createCommandAudioCaptureProvider(input: { command: string; outputFile?: string; id?: string }): AudioCaptureProvider {
  return {
    async capture() {
      const outputFile = input.outputFile ?? join(mkdtempSync(join(tmpdir(), "voice-capture-")), "capture.wav")
      await runCommandWithAudioFile(input.command, outputFile, "audio capture command failed")
      return { id: input.id ?? createTurnId(), audioFile: outputFile }
    }
  }
}

function createTurnId() {
  return `voice-${Date.now()}`
}

function runCommandWithAudioFile(command: string, audioFile: string, failureMessage: string) {
  const prepared = command.includes("{output}") ? command.replaceAll("{output}", shellQuote(audioFile)) : command

  return new Promise<void>((resolve, reject) => {
    const child = spawn(prepared, {
      shell: true,
      env: { ...process.env, VOICE_AUDIO_FILE: audioFile },
      stdio: ["ignore", "ignore", "pipe"]
    })

    child.stderr.resume()
    child.on("error", () => reject(new Error(failureMessage)))
    child.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${failureMessage} with exit code ${code}`))
    })
  })
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}
