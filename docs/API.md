# OpenDoc API (v1)

Base path: `/api/v1`. Interactive docs: `GET /docs` (OpenAPI at `/openapi.json`).
Auth: `Authorization: Bearer <JWT>` from `POST /auth/login` on every route except register/login and the probes.

## Error envelope

Every error has the same shape. `detail` mirrors `error.message`, so clients that read `response.data.detail` keep working.

```json
{
  "error": {"code": "not_found", "message": "Document not found", "details": null, "request_id": "9f2c..."},
  "detail": "Document not found"
}
```

Codes: `bad_request` 400, `unauthorized` 401, `forbidden` 403, `not_found` 404, `conflict` 409, `payload_too_large` 413, `unsupported_media_type` 415, `validation_error` 422 (`details` lists `{loc, msg, type}`), `rate_limited` 429 (with `Retry-After`), `service_unavailable` 503, `internal_error` 500. Every response carries `X-Request-ID`.

## Probes (no prefix, no auth)

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Liveness, no dependencies: `{"status":"ok","version":"2.0.0"}` |
| GET | `/ready` | Readiness: database, pgvector extension, storage, worker. 200 `ready` or 503 `not_ready`, with per-check detail and whether an LLM is configured |

## Auth (unchanged semantics)

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/auth/register` | `{email, password (8-72 bytes), full_name?}` | 201 `{message: "user created", user_id}`; 409 if the email exists |
| POST | `/auth/login` | `{email, password}` | 200 `{access_token, token_type: "bearer", expires_in}`; 401 bad credentials; 403 deactivated |
| GET | `/auth/me` | | `{id, email, full_name, created_at}` |
| PATCH | `/auth/me` | `{full_name?}` | same as GET |

Emails are stored lower-cased. Login and register are rate limited (`RATE_LIMIT_AUTH`).

## Documents

| Method | Path | Notes |
|---|---|---|
| POST | `/upload` | multipart `file`. PDF, DOCX, TXT, MD up to `MAX_UPLOAD_MB`. **202** with the document in `queued` state; ingestion runs in the background. Re-uploading identical bytes returns the existing document with **200** and `duplicate: true` |
| GET | `/documents` | All of the caller's documents, newest first, every status |
| GET | `/documents/{doc_id}` | One document; poll this for `status` / `progress` |
| GET | `/documents/{doc_id}/file-url` | `{url, expires_in}`: a presigned storage URL (600 s, inline) for the viewer. `url` is null with local storage; use `/download` then |
| GET | `/documents/{doc_id}/download` | Original bytes, `Content-Disposition: attachment` |
| DELETE | `/documents/{doc_id}` | Hard delete: row, sections, chunks, stored object; the id is removed from the caller's chats. `{status: "deleted", doc_id}` |
| GET | `/documents/{doc_id}/summary` | Lazy summary: one LLM call on first request, cached afterwards. 409 until the document is `ready`; 503 without an LLM |

Document object:

```json
{
  "doc_id": "uuid", "filename": "contract.pdf", "content_type": "application/pdf",
  "file_size_bytes": 182538, "status": "queued|processing|ready|failed", "progress": 0,
  "error": null, "num_pages": 15, "section_count": 40, "chunk_count": 43,
  "created_at": "...", "updated_at": "..."
}
```

## Chats

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/chats` | | `[{id, title, selected_doc_ids, created_at, updated_at}]`, most recently updated first |
| POST | `/chats` | `{selected_doc_ids?: [uuid]}` | 201. Unknown or foreign ids give 404 |
| GET | `/chats/{id}` | | Chat plus `messages` (oldest first) |
| PATCH | `/chats/{id}` | `{title}` | Rename |
| PATCH | `/chats/{id}/documents` | `{selected_doc_ids}` | Replace the chat's document selection |
| DELETE | `/chats/{id}` | | `{status: "success", message}` |
| POST | `/chats/{id}/messages` | `{question, summary_style?: "executive"\|"detailed"\|"highlights"}` | Answer as a message (below) |
| POST | `/chats/{id}/messages/stream` | same | Server-Sent Events (below) |

Message:

```json
{
  "id": "uuid", "role": "assistant", "content": "Either party may terminate on 90 days' notice [S1].",
  "citations": [{
    "source_id": "S1", "doc_id": "uuid", "document": "contract.pdf", "page": 2,
    "section": "AGREEMENT > 3. Termination", "snippet": "Either party may terminate ...",
    "preview": "Either party may terminate ...", "score": 4.21
  }],
  "latency_ms": 1830, "timestamp": "...", "model": "openai/gpt-oss-120b"
}
```

The first message of a chat generates a short title in the background.

### Streaming (SSE)

`POST /chats/{id}/messages/stream` returns `text/event-stream`:

```
event: meta
data: {"user_message_id": "...", "query_type": "fact", "search_query": "...", "abstained": false, "sources": 4, "retrieval_ms": 912}

event: token
data: {"delta": "Either party "}

...

event: done
data: {<message object as above>, "abstained": false}
```

On failure after the stream started: `event: error` with `{"message": ...}`. Validation, auth, ownership and "documents still processing" errors are returned as normal HTTP errors before the stream starts. If the client disconnects mid-stream the assistant message is not saved (the user message is).

## Stateless query

`POST /query` with `{question, selected_doc_ids}` returns `{answer, citations, model, abstained, query_type}`. No chat history is stored (an audit row is).

## Answering behaviour

* Only documents with `status: ready` are searched. Selecting only unfinished documents gives 409.
* No documents uploaded at all: a fixed answer telling the user to upload (old behaviour kept).
* Documents uploaded but none selected: 400.
* `citations` lists exactly the sources the model cited with `[S#]` markers. An answer with no markers has no citations.
* When the best retrieval score is below the threshold, the API answers *"I could not find sufficient evidence in the selected documents to answer this question."* without calling the LLM, with `abstained: true` and no citations. The model is also instructed to give that sentence when the sources do not contain the answer.
* `summary_style` changes the answer format only. It is no longer prepended to the search query.
* Follow-up questions are rewritten into a standalone search query using recent history (only when history exists).

## Contract changes vs the previous backend

| Area | Before | Now | Frontend impact |
|---|---|---|---|
| Upload status code | 200 after full synchronous ingestion | **202** immediately (`status: queued`), 200 + `duplicate: true` for identical bytes | Poll `GET /documents/{id}` until `ready` before enabling questions |
| Upload response | `{doc_id, filename, sections, sentences, num_pages, status: "indexed"}` | Document object (above) + `duplicate` | `sections` / `sentences` removed; use `section_count` / `chunk_count` once ready |
| Upload formats | PDF only | PDF, DOCX, TXT, MD; 413 over size limit, 415 unsupported/mismatched type | Accept more file types |
| Documents list | `[{doc_id, filename, num_pages}]` (ready only) | Full document objects, every status | Additive; filter or badge non-`ready` items |
| Foreign resources | 403 "Ownership denied" for another user's doc/chat | **404** (existence is not revealed) | Treat 404 as "not found" |
| Document delete | Soft delete, vectors removed | Hard delete incl. stored file; id removed from chats | None |
| Citations | `{document, page, section, score, preview}`; all retrieved chunks when the model cited none | Adds `source_id`, `doc_id`, `snippet` (`preview` kept as an alias); only sources actually cited | Additive; expect empty citations on abstentions |
| Query response | `{answer, citations, model}` | Adds `abstained`, `query_type` | Additive |
| Login response | `{access_token, token_type}` | Adds `expires_in` (seconds) | Additive |
| JWT expiry | 30 min default | 60 min default (`JWT_EXPIRE_MINUTES`) | None |
| Health | `GET /api/v1/health` with `qdrant_status` | `GET /health` (liveness) and `GET /ready` (readiness) at the root | Update any monitor |
| Errors | `{detail}` | `{error: {...}, detail}` | Additive (`detail` kept) |
| Streaming | none | `POST /chats/{id}/messages/stream` | New |
| Summary | per-section LLM summaries during upload | `GET /documents/{id}/summary`, lazy, one call | New |
| Rate limits | none | 429 with `Retry-After` on auth, upload, query/messages | Handle 429 |
