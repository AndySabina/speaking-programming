import type { Plugin } from "@opencode-ai/plugin"
import { createLocalBootstrapSession, getBootstrapFile } from "../../src/voice-orchestrator/bootstrap.js"
import { startVoiceOrchestratorServer } from "../../src/voice-orchestrator/server.js"

type VoiceOrchestratorOptions = {
  port?: number
  tokenEnv?: string
  token?: string
  bootstrapFile?: string
}

const DEFAULT_PORT = 47737
const DEFAULT_TOKEN_ENV = "VOICE_ORCHESTRATOR_TOKEN"

export default (async ({ client }, options?: VoiceOrchestratorOptions) => {
  const port = options?.port ?? DEFAULT_PORT
  const tokenEnv = options?.tokenEnv ?? DEFAULT_TOKEN_ENV
  const bootstrapFile = options?.bootstrapFile ?? getBootstrapFile()
  const configuredToken = options?.token ?? process.env[tokenEnv]
  const session = createLocalBootstrapSession({ port, token: configuredToken, bootstrapFile })

  const server = startVoiceOrchestratorServer({ port, token: session.token, tui: client.tui })
  server.unref()

  await log(client, "info", "Voice orchestrator HTTP adapter started.", { port, endpoint: session.endpoint, bootstrapFile, tokenSource: configuredToken ? "configured" : "generated" })

  return {}
}) satisfies Plugin

type AppLogger = {
  app: {
    log(input: { body: { service: string; level: "info" | "warn" | "error" | "debug"; message: string; extra?: Record<string, unknown> } }): Promise<unknown>
  }
}

async function log(client: AppLogger, level: "info" | "warn", message: string, extra: Record<string, unknown>) {
  await client.app.log({ body: { service: "voice-orchestrator", level, message, extra } })
}
