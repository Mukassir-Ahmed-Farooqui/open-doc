/** Base URL of the API origin, e.g. https://api.example.com (no trailing slash, no /api/v1). */
export const API_ORIGIN: string = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");
export const API_BASE = `${API_ORIGIN}/api/v1`;

export const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md"] as const;
export const ACCEPT_ATTR =
  ".pdf,.docx,.txt,.md,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const INSUFFICIENT_EVIDENCE =
  "I could not find sufficient evidence in the selected documents to answer this question.";
export const NO_DOCUMENTS_ANSWER_PREFIX = "You have not uploaded any documents yet.";

export const UPLOAD_LIMITS = "PDF, DOCX, TXT or Markdown · up to 10 MB and 50 pages each · 5 documents per account";
