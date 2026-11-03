import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, Monitor, Moon, RotateCw, Sun } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { useAuth } from "@/auth/AuthContext";
import { Page, PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Input";
import { Kbd } from "@/components/ui/Kbd";
import { modKey } from "@/lib/platform";
import { Skeleton } from "@/components/ui/Skeleton";
import { keys } from "@/hooks/queries";
import { api } from "@/lib/api/instance";
import { errorMessage } from "@/lib/api/errors";
import { API_ORIGIN } from "@/lib/config";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { useTheme, type ThemePref } from "@/theme/ThemeProvider";

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-line pt-6 md:grid-cols-[220px_1fr]">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function SettingsPage() {
  const { user, isLoadingUser, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const ready = useQuery({ queryKey: keys.ready, queryFn: ({ signal }) => api.ready(signal), retry: false });
  const health = useQuery({ queryKey: ["health"], queryFn: ({ signal }) => api.health(signal), retry: false });

  const themes: { value: ThemePref; label: string; icon: ReactNode }[] = [
    { value: "light", label: "Light", icon: <Sun /> },
    { value: "dark", label: "Dark", icon: <Moon /> },
    { value: "system", label: "System", icon: <Monitor /> },
  ];

  return (
    <Page>
      <PageHeader title="Settings" description="Your profile, appearance and connection." />

      <Section title="Profile" description="How you appear in OpenDoc.">
        {isLoadingUser ? (
          <div className="max-w-md space-y-3">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        ) : (
          <ProfileForm key={user?.full_name ?? ""} />
        )}
      </Section>

      <Section title="Appearance" description="Choose a theme, or follow your system.">
        <div role="radiogroup" aria-label="Theme" className="grid max-w-md grid-cols-3 gap-2">
          {themes.map((t) => (
            <button
              key={t.value}
              role="radio"
              aria-checked={theme === t.value}
              onClick={() => setTheme(t.value)}
              className={cn(
                "flex flex-col items-center gap-2 rounded-xl border p-3 text-sm transition-colors [&_svg]:size-5",
                theme === t.value ? "border-accent bg-accent-soft/50 text-fg" : "border-line text-fg-muted hover:bg-surface-2",
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Keyboard shortcuts">
        <dl className="max-w-md divide-y divide-line rounded-xl border border-line text-sm">
          {[
            ["Command palette", [modKey, "K"]],
            ["Focus input", [modKey, "/"]],
            ["Send message", ["↵"]],
            ["New line", ["⇧", "↵"]],
            ["Previous / next PDF page", ["←", "→"]],
          ].map(([label, combo]) => (
            <div key={label as string} className="flex items-center justify-between px-3 py-2">
              <dt className="text-fg-muted">{label as string}</dt>
              <dd className="flex gap-1">
                {(combo as string[]).map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="System status" description="Live readiness of the OpenDoc API.">
        <div className="max-w-md space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-fg-muted">API</span>
            <code className="truncate font-mono text-xs">{API_ORIGIN || window.location.origin}</code>
          </div>
          {ready.isLoading ? (
            <Skeleton className="h-24" />
          ) : ready.error ? (
            <p className="text-sm text-danger">{errorMessage(ready.error)}</p>
          ) : (
            <dl className="divide-y divide-line rounded-xl border border-line text-sm">
              <div className="flex items-center justify-between px-3 py-2">
                <dt className="text-fg-muted">Overall</dt>
                <dd className={ready.data!.status === "ready" ? "font-medium text-success" : "font-medium text-danger"}>
                  {ready.data!.status === "ready" ? "Ready" : "Not ready"}
                </dd>
              </div>
              {Object.entries(ready.data!.checks).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3 px-3 py-2">
                  <dt className="text-fg-muted capitalize">{k}</dt>
                  <dd className="truncate font-mono text-xs">{v}</dd>
                </div>
              ))}
              {health.data?.version && (
                <div className="flex items-center justify-between px-3 py-2">
                  <dt className="text-fg-muted">Version</dt>
                  <dd className="font-mono text-xs">{health.data.version}</dd>
                </div>
              )}
            </dl>
          )}
          <Button variant="outline" size="sm" onClick={() => { ready.refetch(); health.refetch(); }} loading={ready.isFetching}>
            <RotateCw /> Re-check
          </Button>
        </div>
      </Section>

      <Section title="Session">
        <Button variant="outline" onClick={logout}>
          <LogOut /> Sign out
        </Button>
      </Section>
    </Page>
  );
}

function ProfileForm() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState(user?.full_name ?? "");
  const save = useMutation({
    mutationFn: (full_name: string) => api.updateMe({ full_name }),
    onSuccess: (u) => {
      qc.setQueryData(["me"], u);
      toast.success("Profile updated");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = name.trim();
    if (!v) return toast.error("Name can't be empty.");
    save.mutate(v);
  };
  return (
    <form onSubmit={submit} className="max-w-md space-y-4">
      <Field label="Full name" htmlFor="settings-name">
        <Input id="settings-name" value={name} maxLength={255} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </Field>
      <Field label="Email" htmlFor="settings-email" hint="Email can't be changed.">
        <Input id="settings-email" value={user?.email ?? ""} readOnly disabled />
      </Field>
      {user?.created_at && <p className="text-xs text-fg-subtle">Member since {formatDateTime(user.created_at)}</p>}
      <Button type="submit" variant="primary" loading={save.isPending} disabled={name.trim() === (user?.full_name ?? "")}>
        Save changes
      </Button>
    </form>
  );
}
