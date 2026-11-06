import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { keys } from "@/hooks/queries";
import { api } from "@/lib/api/instance";
import { errorMessage } from "@/lib/api/errors";
import type { DocumentItem } from "@/lib/api/schemas";
import { ACCEPT_ATTR } from "@/lib/config";
import { validateFile } from "@/lib/upload";

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  state: "uploading" | "uploaded" | "error";
  progress: number; // 0..1 of bytes sent
  docId?: string;
  duplicate?: boolean;
  error?: string;
}

interface UploadValue {
  uploads: UploadItem[];
  uploadFiles: (files: FileList | File[]) => void;
  openPicker: () => void;
  dismiss: (id: string) => void;
  clearFinished: () => void;
}

const UploadContext = createContext<UploadValue | null>(null);

/** crypto.randomUUID only exists in secure contexts; self-hosted http:// deployments still need ids. */
let seq = 0;
const newId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `up-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function UploadProvider({ children }: { children: ReactNode }) {
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const patch = useCallback((id: string, p: Partial<UploadItem>) => {
    setUploads((list) => list.map((u) => (u.id === id ? { ...u, ...p } : u)));
  }, []);

  const uploadFiles = useCallback(
    (files: FileList | File[]) => {
      const arr = Array.from(files);
      if (!arr.length) return;
      const items: UploadItem[] = arr.map((f) => ({
        id: newId(),
        name: f.name,
        size: f.size,
        state: "uploading",
        progress: 0,
      }));
      setUploads((list) => [...items, ...list]);
      arr.forEach((file, i) => {
        const item = items[i];
        const invalid = validateFile(file);
        if (invalid) {
          patch(item.id, { state: "error", error: invalid });
          return;
        }
        api
          .uploadDocument(file, { onProgress: (p) => patch(item.id, { progress: p }) })
          .then((doc) => {
            patch(item.id, { state: "uploaded", progress: 1, docId: doc.doc_id, duplicate: doc.duplicate });
            const { duplicate: _dup, ...plain } = doc;
            qc.setQueryData<DocumentItem[]>(keys.documents, (old) =>
              old ? [plain, ...old.filter((d) => d.doc_id !== doc.doc_id)] : [plain],
            );
            qc.invalidateQueries({ queryKey: keys.documents });
            if (doc.duplicate) toast.message(`${file.name} was already uploaded`, { description: "Using the existing document." });
          })
          .catch((err) => patch(item.id, { state: "error", error: errorMessage(err) }));
      });
    },
    [patch, qc],
  );

  const openPicker = useCallback(() => inputRef.current?.click(), []);
  const dismiss = useCallback((id: string) => setUploads((l) => l.filter((u) => u.id !== id)), []);
  const clearFinished = useCallback(() => setUploads((l) => l.filter((u) => u.state === "uploading")), []);

  const value = useMemo(
    () => ({ uploads, uploadFiles, openPicker, dismiss, clearFinished }),
    [uploads, uploadFiles, openPicker, dismiss, clearFinished],
  );

  return (
    <UploadContext.Provider value={value}>
      {children}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          if (e.target.files) uploadFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </UploadContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useUploads(): UploadValue {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error("useUploads must be used inside UploadProvider");
  return ctx;
}
