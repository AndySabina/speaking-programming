# OpenCode Voice Orchestrator

This repository contains the first three review slices for a voice-driven OpenCode orchestrator.

## What works in this slice

- TypeScript scaffold with build and test validation.
- Shared transcript protocol for `append`, `submit`, and `command` actions.
- Project OpenCode config that registers a local plugin and a `/voice-orchestrator` helper command.
- Localhost plugin HTTP adapter at `POST /v1/transcript` with bearer authentication.
- Localhost lifecycle status endpoint at `POST /v1/status`.
- TUI action mapping for prompt append, prompt submit, and allowlisted OpenCode commands.
- Manual/stdin voice bridge fallback with swappable audio and transcription provider ports.

## Setup

```bash
npm install
export VOICE_ORCHESTRATOR_TOKEN="replace-with-a-local-dev-token"
npm run validate
```

Restart OpenCode after changing `opencode.json` or `.opencode/plugin/voice-orchestrator.ts`; OpenCode loads config and plugins at startup.

## Manual bridge fallback

The guaranteed provider path does not require microphone permissions, cloud credentials, or speech-to-text secrets. It treats typed/stdin text as the transcript and still exercises the same confirmation and plugin delivery path that a real STT provider would use later.

```bash
export VOICE_ORCHESTRATOR_TOKEN="replace-with-a-local-dev-token"
npm run voice:bridge -- --text "Run the project validation"
```

Without `--text`, the bridge reads transcript text from stdin:

```bash
printf "Run the project validation" | npm run voice:bridge
```

The bridge asks for explicit confirmation before the first `submit` action. To add a real STT provider later, implement the `AudioCaptureProvider` and `TranscriptionProvider` ports in `src/voice-bridge/` and keep provider credentials outside committed files.

## Runtime smoke checklist

Use this checklist to prove the OpenCode-launched plugin adapter is listening before testing transcript delivery. The smoke helper checks authenticated `GET /v1/ready` only; it does not send transcript text to OpenCode.

### Quick path

1. Start OpenCode from a shell that already has the token:

   ```bash
   export VOICE_ORCHESTRATOR_TOKEN="replace-with-a-local-dev-token"
   opencode
   ```

2. In another shell, set the same token value without printing it and check readiness:

   ```bash
   export VOICE_ORCHESTRATOR_TOKEN="replace-with-the-same-local-dev-token"
   npm run voice:smoke
   ```

3. Expected success signal:

   ```text
   Voice plugin readiness: ready
   Endpoint: http://127.0.0.1:47737
   Authenticated readiness succeeded without transcript delivery.
   ```

4. Only after readiness passes, run the transcript bridge fallback:

   ```bash
   npm run voice:bridge -- --text "Run the project validation"
   ```

### Optional port override

The default endpoint is `http://127.0.0.1:47737`. If the plugin is configured with another port, pass the same port to the smoke helper:

```bash
VOICE_ORCHESTRATOR_PORT=47738 npm run voice:smoke
# or
npm run voice:smoke -- --endpoint http://127.0.0.1:47738
```

### Troubleshooting smoke failures

| Signal | Likely cause | Safe fix |
|---|---|---|
| `missing_token` | The smoke helper shell does not have `VOICE_ORCHESTRATOR_TOKEN`. | Export the token in the smoke helper shell. Do not paste token values into logs or issues. |
| `token_mismatch` | OpenCode and the smoke helper were started with different token values. | Restart OpenCode from a shell with the intended token, then set the same value in the smoke helper shell. |
| `connection_refused` | OpenCode is not running, the plugin did not start, or the port is wrong. | Start/restart OpenCode, confirm the configured port, then rerun `npm run voice:smoke`. |
| `timeout` | The local adapter did not answer within the timeout. | Check for a stale OpenCode process, port conflicts, or a blocked loopback connection. Retry with `npm run voice:smoke -- --timeout-ms 5000` only after checking the runtime. |
| `plugin_unavailable` with HTTP 404 or invalid response | A stale OpenCode process is running old plugin code, or another local service is using the port. | Fully stop OpenCode, restart it after the latest plugin changes, and verify no other process owns the port. |

If OpenCode is launched from a GUI, desktop launcher, or service manager, it may not inherit shell exports. Start OpenCode from the terminal during smoke verification, or configure the launcher environment so `VOICE_ORCHESTRATOR_TOKEN` is present before the process starts.

## Transcript contract

The bridge sends authenticated localhost requests to the plugin:

```json
{
  "id": "turn-1",
  "text": "Run the project validation",
  "final": true,
  "action": "submit",
  "confidence": 0.92
}
```

`POST /v1/transcript` requires `Authorization: Bearer <VOICE_ORCHESTRATOR_TOKEN>`. The plugin binds to `127.0.0.1` only.

Readiness uses the same bearer token at `GET /v1/ready`. The readiness response reports endpoint and diagnostic categories only; it must never print token values.

Lifecycle updates use the same bearer token at `POST /v1/status` with `listening`, `transcribing`, `submitted`, `running`, `done`, or `error`. Status messages are generic by default and do not include transcript text.

Supported command transcripts are allowlisted to OpenCode TUI commands: `agent.cycle`, `prompt.clear`, `prompt.submit`, `session.interrupt`, and `session.new`.

## Current limitations

- OpenCode currently documents plugins, commands, SDK access, and TUI events, but no native in-TUI microphone or voice input box.
- Real microphone capture and speech-to-text providers are extension seams only; the safe fallback is manual/stdin transcript input.
- Do not persist raw audio or full transcripts unless a later provider adapter explicitly documents that behavior.

## Rollback

Remove the `plugin` and `command.voice-orchestrator` entries from `opencode.json`, then restart OpenCode. Normal typed chat is unaffected.
