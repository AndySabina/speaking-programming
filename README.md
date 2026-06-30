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

Lifecycle updates use the same bearer token at `POST /v1/status` with `listening`, `transcribing`, `submitted`, `running`, `done`, or `error`. Status messages are generic by default and do not include transcript text.

Supported command transcripts are allowlisted to OpenCode TUI commands: `agent.cycle`, `prompt.clear`, `prompt.submit`, `session.interrupt`, and `session.new`.

## Current limitations

- OpenCode currently documents plugins, commands, SDK access, and TUI events, but no native in-TUI microphone or voice input box.
- Real microphone capture and speech-to-text providers are extension seams only; the safe fallback is manual/stdin transcript input.
- Do not persist raw audio or full transcripts unless a later provider adapter explicitly documents that behavior.

## Rollback

Remove the `plugin` and `command.voice-orchestrator` entries from `opencode.json`, then restart OpenCode. Normal typed chat is unaffected.
