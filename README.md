# OpenCode Voice Orchestrator

This repository contains a review-sliced implementation for a voice-driven OpenCode orchestrator.

## What works in this slice

- TypeScript scaffold with build and test validation.
- Shared transcript protocol for `append`, `submit`, and `command` actions.
- Project OpenCode config that registers a local plugin and a `/voice-orchestrator` helper command.
- Localhost plugin HTTP adapter at `POST /v1/transcript` with bearer authentication.
- Automatic localhost bootstrap so normal plugin/bridge use does not require manually sharing `VOICE_ORCHESTRATOR_TOKEN`.
- Localhost lifecycle status endpoint at `POST /v1/status`.
- TUI action mapping for prompt append, prompt submit, and allowlisted OpenCode commands.
- Manual/stdin voice bridge fallback plus a command-based microphone/audio-file STT path behind swappable provider ports.

## Setup

```bash
npm install
npm run validate
```

Restart OpenCode after changing `opencode.json` or `.opencode/plugin/voice-orchestrator.ts`; OpenCode loads config and plugins at startup.

## Manual bridge fallback

The guaranteed provider path does not require microphone permissions, cloud credentials, or speech-to-text secrets. It treats typed/stdin text as the transcript and still exercises the same confirmation and plugin delivery path that a real STT provider would use later.

```bash
npm run voice:bridge -- --text "Run the project validation"
```

Without `--text`, the bridge reads transcript text from stdin:

```bash
printf "Run the project validation" | npm run voice:bridge
```

The bridge asks for explicit confirmation before the first `submit` action.

## Real voice path with command providers

The first real STT path is command-based so it can use local tools without committed secrets. OpenCode still owns the localhost plugin endpoint and bootstrap token; recording and transcription run in the external bridge process.

### Prerequisites

- Start OpenCode from this project so the plugin writes the local bootstrap session.
- Install an audio recorder such as `arecord`, `rec`, or `ffmpeg`.
- Install an STT CLI such as `whisper.cpp`'s `whisper-cli`, another local Whisper wrapper, or a cloud CLI. If the STT CLI needs credentials, configure them in that tool's runtime environment only; do not put keys in `opencode.json`, README snippets, or committed files.

### From `opencode` to spoken command

1. Start OpenCode:

   ```bash
   opencode
   ```

2. In OpenCode, run `/voice-orchestrator` and confirm that you want to enter voice mode.

3. In another shell, verify the plugin is reachable:

   ```bash
   npm run voice:smoke
   ```

4. Start a live recording/transcription bridge. The recorder command receives a temporary output path as `{output}` and as `VOICE_AUDIO_FILE`; the STT command receives the audio file as `{file}` and as `VOICE_AUDIO_FILE`, and must print the transcript to stdout. The bridge removes its internally-created temporary recording after the turn completes or fails.

   ```bash
   VOICE_RECORDER_COMMAND="arecord -d 5 -f cd {output}" \
   VOICE_STT_COMMAND="whisper-cli -m /path/to/ggml-base.en.bin -f {file} --no-timestamps" \
   npm run voice:listen
   ```

5. Speak the instruction, review the transcript confirmation, and approve it to submit into OpenCode.

### Audio-file STT path

If direct microphone capture is not portable on the current machine, record a file with your OS tool first and send that file through the same STT provider. Explicit `--audio-file` inputs are treated as user-owned files and are not deleted by the bridge:

```bash
VOICE_STT_COMMAND="whisper-cli -m /path/to/ggml-base.en.bin -f {file} --no-timestamps" \
npm run voice:bridge -- --provider command --audio-file ./sample.wav
```

This path is the portable first implementation. Native cross-platform microphone capture is intentionally not embedded in the OpenCode plugin because OpenCode does not expose a documented microphone API; OS recording remains an explicit bridge prerequisite.

## Runtime smoke checklist

Use this checklist to prove the OpenCode-launched plugin adapter is listening before testing transcript delivery. The smoke helper checks authenticated `GET /v1/ready` only; it does not send transcript text to OpenCode.

### Quick path

1. Start OpenCode from this project:

   ```bash
   opencode
   ```

2. In another shell, check readiness. The helper reads the local bootstrap session written by the plugin:

   ```bash
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
| `missing_token` | OpenCode has not written a local bootstrap session and no explicit token override exists. | Start or restart OpenCode from this project so the plugin can bootstrap localhost auth. |
| `token_mismatch` | The bridge found a stale bootstrap session or an explicit token override from another OpenCode session. | Restart OpenCode from this project and avoid setting `VOICE_ORCHESTRATOR_TOKEN` unless debugging compatibility. |
| `connection_refused` | OpenCode is not running, the plugin did not start, or the port is wrong. | Start/restart OpenCode, confirm the configured port, then rerun `npm run voice:smoke`. |
| `timeout` | The local adapter did not answer within the timeout. | Check for a stale OpenCode process, port conflicts, or a blocked loopback connection. Retry with `npm run voice:smoke -- --timeout-ms 5000` only after checking the runtime. |
| `plugin_unavailable` with HTTP 404 or invalid response | A stale OpenCode process is running old plugin code, or another local service is using the port. | Fully stop OpenCode, restart it after the latest plugin changes, and verify no other process owns the port. |

The bootstrap session is stored in a local runtime file with restrictive file permissions. It is for localhost bridge tooling only and must not be copied into logs, issues, or shared docs.

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

`POST /v1/transcript` requires `Authorization: Bearer <local session token>`. The plugin generates this token automatically when no compatibility override is provided, writes it to the local bootstrap session, and binds to `127.0.0.1` only.

Readiness uses the same bearer token at `GET /v1/ready`. The readiness response reports endpoint and diagnostic categories only; it must never print token values.

Lifecycle updates use the same bearer token at `POST /v1/status` with `listening`, `transcribing`, `submitted`, `running`, `done`, or `error`. Status messages are generic by default and do not include transcript text.

Supported command transcripts are allowlisted to OpenCode TUI commands: `agent.cycle`, `prompt.clear`, `prompt.submit`, `session.interrupt`, and `session.new`.

## Current limitations

- OpenCode currently documents plugins, commands, SDK access, and TUI events, but no native in-TUI microphone or voice input box.
- Native in-plugin microphone capture is not implemented; the real voice path uses external recorder/STT commands from the bridge process.
- Do not persist raw audio or full transcripts unless a later provider adapter explicitly documents that behavior.

## Rollback

Remove the `plugin` and `command.voice-orchestrator` entries from `opencode.json`, then restart OpenCode. Normal typed chat is unaffected.
