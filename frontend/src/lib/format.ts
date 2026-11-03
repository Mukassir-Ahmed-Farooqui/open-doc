export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

const rtf = typeof Intl !== "undefined" ? new Intl.RelativeTimeFormat("en", { numeric: "auto" }) : null;

export function formatRelative(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = (d.getTime() - now.getTime()) / 1000;
  const abs = Math.abs(diff);
  const table: [number, Intl.RelativeTimeFormatUnit, number][] = [
    [60, "second", 1],
    [3600, "minute", 60],
    [86400, "hour", 3600],
    [604800, "day", 86400],
    [2629800, "week", 604800],
    [31557600, "month", 2629800],
    [Infinity, "year", 31557600],
  ];
  if (abs < 45) return "just now";
  for (const [limit, unit, div] of table) {
    if (abs < limit) return rtf ? rtf.format(Math.round(diff / div), unit) : d.toLocaleString();
  }
  return d.toLocaleDateString();
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function fileExtension(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i).toLowerCase() : "";
}

export type DocKind = "pdf" | "docx" | "md" | "txt" | "other";

export function docKind(filename: string, contentType = ""): DocKind {
  const ext = fileExtension(filename);
  if (ext === ".pdf" || contentType === "application/pdf") return "pdf";
  if (ext === ".docx" || contentType.includes("wordprocessingml")) return "docx";
  if (ext === ".md" || contentType === "text/markdown") return "md";
  if (ext === ".txt" || contentType.startsWith("text/")) return "txt";
  return "other";
}
