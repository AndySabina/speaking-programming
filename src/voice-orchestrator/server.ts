import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { accepted, notReady, ready, rejected, validateTranscriptRequest, validateVoiceStatusRequest, type TranscriptRequest, type VoiceLifecycleStatus } from "../protocol/voice.js"

export type VoiceServerOptions = {
  port: number
  token: string
  tui: VoiceTuiClient
}

export type VoiceTuiClient = {
  appendPrompt(input: { body: { text: string } }): Promise<unknown>
  submitPrompt(input?: { body?: never }): Promise<unknown>
  executeCommand(input: { body: { command: string } }): Promise<unknown>
  showToast(input: { body: { title?: string; message: string; variant: "info" | "success" | "warning" | "error"; duration?: number } }): Promise<unknown>
}

const ALLOWED_COMMANDS = new Set(["agent.cycle", "prompt.clear", "prompt.submit", "session.interrupt", "session.new"])

export function startVoiceOrchestratorServer({ port, token, tui }: VoiceServerOptions): Server {
  const server = createServer(async (request, response) => {
    const route = request.url ?? ""
    const endpoint = getServerEndpoint(server, port)

    if (request.method === "GET" && route === "/v1/ready") {
      if (request.headers.authorization !== `Bearer ${token}`) {
        writeJson(response, 401, notReady({ code: "token_mismatch", message: "Missing or invalid bearer token." }, endpoint))
        return
      }

      writeJson(response, 200, ready(endpoint))
      return
    }

    if (request.method !== "POST" || !["/v1/transcript", "/v1/status"].includes(route)) {
      writeJson(response, 404, rejected("route not found"))
      return
    }

    if (request.headers.authorization !== `Bearer ${token}`) {
      await showStatus(tui, "Voice request rejected", "Missing or invalid bearer token.", "error")
      writeJson(response, 401, rejected("unauthorized"))
      return
    }

    const body = await readJson(request)
    if (!body.ok) {
      await showStatus(tui, "Voice request rejected", body.error, "error")
      writeJson(response, 400, rejected(body.error))
      return
    }

    if (route === "/v1/status") {
      const validation = validateVoiceStatusRequest(body.value)
      if (!validation.ok) {
        await showStatus(tui, "Voice status rejected", validation.error, "error")
        writeJson(response, 400, rejected(validation.error))
        return
      }

      await showLifecycleStatus(tui, validation.value.status, validation.value.message)
      writeJson(response, 202, accepted("status accepted"))
      return
    }

    const validation = validateTranscriptRequest(body.value)
    if (!validation.ok) {
      await showStatus(tui, "Voice request rejected", validation.error, "error")
      writeJson(response, 400, rejected(validation.error))
      return
    }

    const mapped = await applyTranscriptAction(tui, validation.value)
    writeJson(response, mapped.ok ? 202 : 400, mapped)
  })

  return server.listen(port, "127.0.0.1")
}

export async function applyTranscriptAction(tui: VoiceTuiClient, request: TranscriptRequest) {
  if (request.action === "append") {
    await tui.appendPrompt({ body: { text: request.text } })
    await showStatus(tui, "Voice transcript appended", "Transcript text was added to the prompt.", "info")
    return accepted("transcript appended")
  }

  if (request.action === "submit") {
    await tui.appendPrompt({ body: { text: request.text } })
    await showStatus(tui, "Voice transcript submitted", "Transcript text was submitted to OpenCode.", "success")
    await tui.submitPrompt()
    await showStatus(tui, "OpenCode running", "The dictated instruction is running.", "info")
    return accepted("transcript submitted")
  }

  if (!ALLOWED_COMMANDS.has(request.text)) {
    await showStatus(tui, "Voice command rejected", "The requested command is not allowlisted.", "warning")
    return rejected("unsupported command")
  }

  await tui.executeCommand({ body: { command: request.text } })
  await showStatus(tui, "Voice command accepted", `Command ${request.text} was executed.`, "success")
  return accepted("command executed")
}

async function showStatus(tui: VoiceTuiClient, title: string, message: string, variant: "info" | "success" | "warning" | "error") {
  await tui.showToast({ body: { title, message, variant, duration: 3000 } })
}

async function showLifecycleStatus(tui: VoiceTuiClient, status: VoiceLifecycleStatus, message?: string) {
  const statusMap: Record<VoiceLifecycleStatus, { title: string; message: string; variant: "info" | "success" | "warning" | "error" }> = {
    listening: { title: "Voice listening", message: "Listening for dictated instruction.", variant: "info" },
    transcribing: { title: "Voice transcribing", message: "Transcribing captured audio.", variant: "info" },
    submitted: { title: "Voice transcript submitted", message: "Transcript text was submitted to OpenCode.", variant: "success" },
    running: { title: "OpenCode running", message: "The dictated instruction is running.", variant: "info" },
    done: { title: "Voice session done", message: "Voice session completed.", variant: "success" },
    error: { title: "Voice session error", message: "Voice session failed.", variant: "error" }
  }
  const next = statusMap[status]
  await showStatus(tui, next.title, message ?? next.message, next.variant)
}

async function readJson(request: IncomingMessage): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))

  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) }
  } catch {
    return { ok: false, error: "request body must be valid JSON" }
  }
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.writeHead(statusCode, { "content-type": "application/json" })
  response.end(JSON.stringify(body))
}

function getServerEndpoint(server: Server, configuredPort: number) {
  const address = server.address()
  if (typeof address === "object" && address) return `http://127.0.0.1:${address.port}`
  return `http://127.0.0.1:${configuredPort}`
}
