# ClauseScope Sprint 3 Handoff — Workspace UX Modernization

This document outlines the architectural changes, component designs, and verification results for the Workspace UX Modernization sprint.

---

## 1. Architectural Changes

### Database Layer
* **`chats` table**: Appended a `selected_doc_ids` list column (`JSONB` in Neon PostgreSQL, mapping to SQLAlchemy `JSON`) to store chat-specific document scopes.
* **`documents` table**: Appended a `num_pages` column to persist page counts extracted during file ingestion.

### Backend Routing & Logic
* **`GET /api/v1/auth/me`**: Retrieves details of the authenticated user (ID, email, full name, created timestamp) to sync profile widgets.
* **`PATCH /api/v1/chats/{chat_id}/documents`**: Updates a chat session's active document selection. Enforces multitenancy (checks if the user owns all selected documents and returns `403` or `404` for invalid IDs).
* **Asynchronous Title Generation**: After the first message is posted to a chat, a background task (`generate_chat_title_async`) is dispatched. It invokes Groq (`llama-3.1-8b-instant`) to generate a concise 4-6 word title with zero inline latency.
* **Query Dispatching & Combined Ingest summaries**: Handled multi-document retrieval. Queries sent to `/api/v1/query` or `/messages` execute queries isolated to `selected_doc_ids`.

---

## 2. Frontend Component Redesign

### User Experience Layouts
* **Initials-Based Avatar & Profile Menu**:
  * Added a dropdown menu in the top navigation bar showing the user's name, email, and options.
  * Initials are parsed dynamically from the database profile metadata (e.g. `MA` from "Mukassir Ahmed").
  * Links directly to the new dedicated Settings page or signs the user out.
* **Dedicated Settings Page (`/settings`)**:
  * **Profile Details**: Displays standard legal auditor metadata including sign-up date.
  * **Theme Choice**: LocalStorage-persisted preference toggling light/dark workspace styles.
  * **Default Workspace Selection**: Choose whether to start new chats with all documents checkboxed ("All Contracts") or empty ("Manually Select").
  * **Default Summary style**: Choose the synthesis mode format ("Executive Summary", "Detailed Outline", or "Key Highlights").
* **Pulsing Skeleton Loader**:
  * Renders a fluid sidebar pulsing skeleton during chat history loading.
  * Renders conversation bubble skeletons during historical messages loading.

### Documents Selection Panel
* **Contract Search**: Quick filter text box searching filenames in real time.
* **Interactive checklist**: Interactive checkboxes next to document cards to update workspace selection instantly.
* **Bulk actions**: "Select All" and "Clear Selection" actions working relative to the search filter.
* **Document Cards**: Renders page counts (e.g. `14 Pages`) and "Indexed" badges.

---

## 3. Verification & Testing

Backend routes and validation flows have been validated programmatically via `scripts/validate_sprint3.py`.

### Test Results

```text
=== STARTING SPRINT 3 BACKEND VALIDATION ===

1. Registering user: test_user_7efdb2@example.com...
[OK] Registration successful.

2. Logging in...
[OK] Login successful. Token retrieved.

3. Testing GET /api/v1/auth/me profile endpoint...
[OK] Profile verified successfully: {
  'id': 'e26cb98c-f0dd-44ad-acaa-8f6c04af1c84',
  'email': 'test_user_7efdb2@example.com',
  'full_name': 'Sprint Three Auditor',
  'created_at': '2026-06-05T20:37:30.480309+00:00'
}

4. Creating a new chat session...
[OK] Chat created successfully with ID: 31892dc0-7840-4cc1-b034-989a45880847

5. Testing PATCH /api/v1/chats/{chat_id}/documents selection update...
[OK] Workspace PATCH empty list verified.

6. Testing workspace validation on invalid document UUID...
[OK] Document UUID validation verified (returned 404 as expected).

7. Sending first message to trigger background title generation...
[OK] First message posted. Waiting 3 seconds for background title generation task...

8. Fetching chat detail to verify async generated title...
-> Current Chat Title: 'Standard NDA Termination Clause Requirements'
[OK] Title successfully updated by async background worker using Groq!

=== ALL SPRINT 3 BACKEND VALIDATION TESTS PASSED ===
```
