import { Link } from "react-router-dom";
import { EmptyState } from "@/components/ui/States";

export function NotFoundPage() {
  return (
    <EmptyState
      className="h-full"
      title="Page not found"
      description="The page you're looking for doesn't exist."
      action={
        <Link to="/" className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-sm font-medium text-accent-fg hover:bg-accent-hover">
          Go home
        </Link>
      }
    />
  );
}
