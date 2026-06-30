import { createHash, randomBytes } from "node:crypto"
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"

export type VoiceBootstrapSession = {
  endpoint: string
  token: string
  port: number
  pid: number
  createdAt: string
}

export type CreateBootstrapSessionOptions = {
  port: number
  token?: string
  bootstrapFile?: string
  now?: Date
}

const DEFAULT_BOOTSTRAP_DIR = join(tmpdir(), "opencode-voice-orchestrator")

export function createLocalBootstrapSession(options: CreateBootstrapSessionOptions): VoiceBootstrapSession {
  const endpoint = `http://127.0.0.1:${options.port}`
  const session: VoiceBootstrapSession = {
    endpoint,
    token: options.token?.trim() || generateLocalToken(),
    port: options.port,
    pid: process.pid,
    createdAt: (options.now ?? new Date()).toISOString()
  }

  writeBootstrapSession(session, options.bootstrapFile)
  return session
}

export function readLocalBootstrapSession(bootstrapFile = getBootstrapFile()): VoiceBootstrapSession | undefined {
  try {
    return validateBootstrapSession(JSON.parse(readFileSync(bootstrapFile, "utf8")))
  } catch {
    return undefined
  }
}

export function getBootstrapFile() {
  return process.env.VOICE_ORCHESTRATOR_BOOTSTRAP_FILE?.trim() || join(DEFAULT_BOOTSTRAP_DIR, `${projectRuntimeId()}.json`)
}

function writeBootstrapSession(session: VoiceBootstrapSession, bootstrapFile = getBootstrapFile()) {
  mkdirSync(dirname(bootstrapFile), { recursive: true, mode: 0o700 })
  writeFileSync(bootstrapFile, `${JSON.stringify(session)}\n`, { mode: 0o600 })
  chmodSync(bootstrapFile, 0o600)
}

function validateBootstrapSession(input: unknown): VoiceBootstrapSession | undefined {
  if (!isRecord(input)) return undefined
  if (typeof input.endpoint !== "string" || !isLocalHttpEndpoint(input.endpoint)) return undefined
  if (typeof input.token !== "string" || input.token.trim().length === 0) return undefined
  if (typeof input.port !== "number" || !Number.isInteger(input.port) || input.port <= 0) return undefined
  if (typeof input.pid !== "number" || !Number.isInteger(input.pid) || input.pid <= 0) return undefined
  if (typeof input.createdAt !== "string" || input.createdAt.trim().length === 0) return undefined

  return {
    endpoint: input.endpoint,
    token: input.token.trim(),
    port: input.port,
    pid: input.pid,
    createdAt: input.createdAt
  }
}

function isLocalHttpEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint)
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname)
  } catch {
    return false
  }
}

function generateLocalToken() {
  return randomBytes(32).toString("base64url")
}

function projectRuntimeId() {
  const cwd = process.cwd()
  const name = basename(cwd).replace(/[^a-zA-Z0-9._-]/g, "-") || "project"
  const hash = createHash("sha256").update(cwd).digest("hex").slice(0, 12)
  return `${name}-${hash}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
