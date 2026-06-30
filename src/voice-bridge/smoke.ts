#!/usr/bin/env node
import { checkPluginReadiness, resolveBridgeConfig } from "./index.js"
import type { VoiceReadinessResponse } from "../protocol/voice.js"

const DEFAULT_HOST = "127.0.0.1"
const DEFAULT_PORT = "47737"
const DEFAULT_TIMEOUT_MS = 2000

type SmokeArgs = {
  endpoint?: string
  port?: string
  timeoutMs?: number
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const endpoint = args.endpoint ?? (args.port ? `http://${DEFAULT_HOST}:${args.port}` : undefined)
  const config = resolveBridgeConfig({ endpoint, port: process.env.VOICE_ORCHESTRATOR_PORT ?? DEFAULT_PORT })
  const readiness = await checkPluginReadiness(config, { timeoutMs: args.timeoutMs ?? DEFAULT_TIMEOUT_MS })

  if (readiness.ok) {
    console.log(formatSuccess(readiness))
    return
  }

  console.error(formatFailure(readiness))
  process.exitCode = 1
}

function parseArgs(args: string[]): SmokeArgs {
  const parsed: SmokeArgs = {}

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const next = args[index + 1]

    if (arg === "--endpoint" && next) {
      parsed.endpoint = next
      index += 1
      continue
    }

    if (arg === "--port" && next) {
      parsed.port = next
      index += 1
      continue
    }

    if (arg === "--timeout-ms" && next) {
      const value = Number(next)
      if (Number.isFinite(value) && value > 0) parsed.timeoutMs = value
      index += 1
    }
  }

  return parsed
}

function formatSuccess(readiness: VoiceReadinessResponse) {
  return [
    "Voice plugin readiness: ready",
    `Endpoint: ${readiness.endpoint ?? "unknown"}`,
    "Authenticated readiness succeeded without transcript delivery."
  ].join("\n")
}

function formatFailure(readiness: VoiceReadinessResponse) {
  const endpoint = readiness.endpoint ? `Endpoint: ${readiness.endpoint}` : "Endpoint: unknown"
  const diagnostics = readiness.diagnostics.map((diagnostic) => `- ${diagnostic.code}: ${diagnostic.message}`)
  return [
    "Voice plugin readiness: not ready",
    endpoint,
    "Diagnostics:",
    ...(diagnostics.length > 0 ? diagnostics : ["- plugin_unavailable: No readiness diagnostics were returned."]),
    "Next checks: confirm OpenCode is running with the plugin loaded, restart OpenCode after config changes, and verify the expected port."
  ].join("\n")
}

await main()
