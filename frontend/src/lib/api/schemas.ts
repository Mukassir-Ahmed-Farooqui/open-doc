import { z } from "zod";

/* Mirrors backend/app/schemas/*.py. Unknown keys are tolerated (zod strips them). */

export const DocumentStatusSchema = z.enum(["queued", "processing", "ready", "failed"]);
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

export const DocumentSchema = z.object({
  doc_id: z.string(),
  filename: z.string(),
  content_type: z.string(),
  file_size_bytes: z.number(),
  status: DocumentStatusSchema,
  progress: z.number(),
  error: z.string().nullable(),
  num_pages: z.number(),
  section_count: z.number(),
  chunk_count: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type DocumentItem = z.infer<typeof DocumentSchema>;

export const UploadResponseSchema = DocumentSchema.extend({ duplicate: z.boolean().default(false) });
export type UploadResponse = z.infer<typeof UploadResponseSchema>;

export const DeleteResponseSchema = z.object({ status: z.string(), doc_id: z.string() });
export const SummaryResponseSchema = z.object({
  doc_id: z.string(),
  summary: z.string(),
  model: z.string().nullable(),
});
export type SummaryResponse = z.infer<typeof SummaryResponseSchema>;

export const CitationSchema = z.object({
  source_id: z.string(),
  doc_id: z.string(),
  document: z.string(),
  page: z.number(),
  section: z.string(),
  snippet: z.string(),
  preview: z.string().optional(),
  score: z.number().nullable().optional(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const MessageSchema = z.object({
  id: z.string(),
  role: z.string(),
  content: z.string(),
  citations: z.array(CitationSchema).nullable().optional(),
  latency_ms: z.number().nullable().optional(),
  timestamp: z.string(),
  model: z.string().nullable().optional(),
});
export type Message = z.infer<typeof MessageSchema>;

export const ChatSchema = z.object({
  id: z.string(),
  title: z.string(),
  selected_doc_ids: z.array(z.string()).default([]),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Chat = z.infer<typeof ChatSchema>;

export const ChatDetailSchema = ChatSchema.extend({ messages: z.array(MessageSchema).default([]) });
export type ChatDetail = z.infer<typeof ChatDetailSchema>;

export const StatusResponseSchema = z.object({ status: z.string(), message: z.string().nullable().optional() });

export const TokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
});
export type TokenResponse = z.infer<typeof TokenResponseSchema>;

export const RegisterResponseSchema = z.object({ message: z.string(), user_id: z.string() });

export const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  full_name: z.string().nullable(),
  created_at: z.string(),
});
export type User = z.infer<typeof UserSchema>;

export const HealthSchema = z.object({ status: z.string(), version: z.string().optional() });
export const ReadySchema = z.object({ status: z.string(), checks: z.record(z.string(), z.string()) });
export type ReadyResponse = z.infer<typeof ReadySchema>;

export const ErrorEnvelopeSchema = z.object({
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
      request_id: z.string().nullable().optional(),
    })
    .optional(),
  detail: z.unknown().optional(),
});

/* SSE event payloads */
export const StreamMetaSchema = z.object({
  user_message_id: z.string(),
  query_type: z.string().optional(),
  search_query: z.string().optional(),
  abstained: z.boolean().optional(),
  sources: z.number().optional(),
  retrieval_ms: z.number().optional(),
});
export type StreamMeta = z.infer<typeof StreamMetaSchema>;
export const StreamTokenSchema = z.object({ delta: z.string() });
export const StreamDoneSchema = MessageSchema.extend({ abstained: z.boolean().optional() });
export type StreamDone = z.infer<typeof StreamDoneSchema>;
export const StreamErrorSchema = z.object({ message: z.string() });

export type SummaryStyle = "executive" | "detailed" | "highlights";
