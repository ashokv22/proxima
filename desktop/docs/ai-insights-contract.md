# Local AI Insights contract

Local Text Workbench talks to one fixed dependency:

- `GET http://127.0.0.1:8000/v1/models` for availability.
- `POST http://127.0.0.1:8000/v1/chat/completions` for analysis.

Neither Tauri command accepts a base URL. React cannot call llama.cpp directly.

## `check_ai_status`

Returns `{ "connected": true | false }`. Connection errors, timeouts, and non-2xx responses produce `false`; they are not persisted or logged.

## `analyze_logs`

Accepts one `evidence` string. The React caller passes only the deterministic processor output. The command:

1. Rejects empty evidence and values larger than 64 KiB.
2. Selects at most 80 lines and 8 KiB, using the beginning and end when omission is required. This leaves room in a 4096-token model context for the safety prompt and generated answer.
3. Sends the subset as JSON data in a user message, under a system instruction that treats it as untrusted evidence rather than instructions.
4. Uses temperature `0.1`, at most `256` output tokens, no streaming, and a 90-second request timeout. The bound accommodates cold prompt evaluation and generation on a local CPU while still failing predictably.

Successful output is `{ content, evidenceLines, evidenceBytes, truncated }`.

Errors are stable codes that never contain evidence, response bodies, or model output:

- `AI_NOT_RUNNING`
- `AI_TIMEOUT`
- `AI_HTTP_ERROR`
- `AI_INVALID_RESPONSE`
- `AI_INPUT_TOO_LARGE`
- `AI_NO_EVIDENCE`

No request or response content is logged or persisted.
