import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api/instance";
import { errorMessage } from "@/lib/api/errors";
import type { Chat, DocumentItem } from "@/lib/api/schemas";

export const keys = {
  documents: ["documents"] as const,
  document: (id: string) => ["documents", id] as const,
  summary: (id: string) => ["documents", id, "summary"] as const,
  file: (id: string) => ["documents", id, "file"] as const,
  chats: ["chats"] as const,
  chat: (id: string) => ["chats", id] as const,
  ready: ["ready"] as const,
};

export const isPending = (d: Pick<DocumentItem, "status">) => d.status === "queued" || d.status === "processing";

/** All documents; polls every 2 s while any document is still being ingested. */
export function useDocuments() {
  return useQuery({
    queryKey: keys.documents,
    queryFn: ({ signal }) => api.listDocuments(signal),
    refetchInterval: (q) => (q.state.data?.some(isPending) ? 2000 : false),
  });
}

export function useDocument(docId: string | undefined) {
  return useQuery({
    queryKey: keys.document(docId ?? ""),
    queryFn: ({ signal }) => api.getDocument(docId!, signal),
    enabled: !!docId,
    refetchInterval: (q) => (q.state.data && isPending(q.state.data) ? 2000 : false),
  });
}

/** Original file bytes (auth-protected, so fetched as a blob rather than via <a href>). */
export function useDocumentFile(docId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.file(docId ?? ""),
    queryFn: ({ signal }) => api.downloadDocument(docId!, signal),
    enabled: !!docId && enabled,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (doc: DocumentItem) => api.deleteDocument(doc.doc_id),
    onSuccess: (_r, doc) => {
      qc.setQueryData<DocumentItem[]>(keys.documents, (old) => old?.filter((d) => d.doc_id !== doc.doc_id));
      qc.removeQueries({ queryKey: keys.document(doc.doc_id) });
      qc.invalidateQueries({ queryKey: keys.chats });
      toast.success(`Deleted ${doc.filename}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export async function downloadToDisk(doc: Pick<DocumentItem, "doc_id" | "filename">) {
  try {
    const blob = await api.downloadDocument(doc.doc_id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = doc.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    toast.error(errorMessage(err));
  }
}

export function useChats() {
  return useQuery({ queryKey: keys.chats, queryFn: ({ signal }) => api.listChats(signal) });
}

export function useChat(chatId: string | undefined) {
  return useQuery({
    queryKey: keys.chat(chatId ?? ""),
    queryFn: ({ signal }) => api.getChat(chatId!, signal),
    enabled: !!chatId,
    retry: (count, err) => !(err && "status" in err && (err as { status: number }).status === 404) && count < 2,
  });
}

export function useRenameChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => api.renameChat(id, title),
    onSuccess: (chat) => {
      qc.setQueryData<Chat[]>(keys.chats, (old) => old?.map((c) => (c.id === chat.id ? { ...c, ...chat } : c)));
      qc.invalidateQueries({ queryKey: keys.chat(chat.id) });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useDeleteChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteChat(id),
    onSuccess: (_r, id) => {
      qc.setQueryData<Chat[]>(keys.chats, (old) => old?.filter((c) => c.id !== id));
      qc.removeQueries({ queryKey: keys.chat(id) });
      toast.success("Conversation deleted");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}
