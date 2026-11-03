import { ACCEPTED_EXTENSIONS } from "./config";
import { fileExtension } from "./format";

export function validateFile(file: File): string | null {
  const ext = fileExtension(file.name);
  if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(ext)) {
    return `Unsupported file type${ext ? ` (${ext})` : ""}. Use PDF, DOCX, TXT or MD.`;
  }
  if (file.size === 0) return "The file is empty.";
  return null;
}
