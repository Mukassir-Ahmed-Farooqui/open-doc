import { Download, Eye, MessageSquarePlus, MoreHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/Menu";
import { downloadToDisk, useDeleteDocument } from "@/hooks/queries";
import type { DocumentItem } from "@/lib/api/schemas";

export function DocumentActions({ doc, onDeleted }: { doc: DocumentItem; onDeleted?: () => void }) {
  const navigate = useNavigate();
  const del = useDeleteDocument();
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${doc.filename}`}>
            <MoreHorizontal />
          </Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem icon={<Eye />} onSelect={() => navigate(`/documents/${doc.doc_id}`)}>
            Open
          </MenuItem>
          {doc.status === "ready" && (
            <MenuItem icon={<MessageSquarePlus />} onSelect={() => navigate(`/chat?docs=${doc.doc_id}`)}>
              Ask about this
            </MenuItem>
          )}
          <MenuItem icon={<Download />} onSelect={() => downloadToDisk(doc)}>
            Download
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Trash2 />} destructive onSelect={() => setConfirm(true)}>
            Delete
          </MenuItem>
        </MenuContent>
      </Menu>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Delete document?"
        description={
          <>
            <span className="font-medium text-fg">{doc.filename}</span> and its index will be permanently removed and
            dropped from any conversations that use it. This cannot be undone.
          </>
        }
        confirmLabel="Delete"
        destructive
        loading={del.isPending}
        onConfirm={() =>
          del.mutate(doc, {
            onSuccess: () => {
              setConfirm(false);
              onDeleted?.();
            },
          })
        }
      />
    </>
  );
}
