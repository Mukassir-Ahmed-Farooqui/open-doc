import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { Logo } from "@/components/layout/Logo";
import { CitationChip } from "@/components/chat/CitationChip";
import { Button } from "@/components/ui/Button";
import { useWakeState } from "@/hooks/useWakeState";
import { Field, Input } from "@/components/ui/Input";
import { errorMessage } from "@/lib/api/errors";

function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="safe-area grid min-h-dvh bg-bg lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-5 sm:px-10">
        <header className="flex h-16 items-center">
          <Link to="/" aria-label="OpenDoc home" className="flex min-h-11 items-center rounded-md">
            <Logo />
          </Link>
        </header>
        <main className="flex flex-1 items-start justify-center pt-[6vh] pb-16 lg:items-center lg:pt-0">
          <div className="w-full max-w-sm animate-rise-in">
            <h1 className="font-serif text-3xl font-semibold tracking-[-0.015em] text-fg">{title}</h1>
            <p className="mt-2 text-base text-fg-muted">{subtitle}</p>
            <div className="mt-8">{children}</div>
            <p className="mt-8 border-t border-line pt-6 text-sm text-fg-muted">{footer}</p>
          </div>
        </main>
      </div>
      <aside aria-hidden inert className="hidden border-l border-line bg-surface-2 lg:flex lg:items-center lg:justify-center lg:p-12">
        <SampleNote />
      </aside>
    </div>
  );
}

/** Static illustration of what OpenDoc produces: a cited answer and the passage it points to. */
function SampleNote() {
  const cite = { source_id: "S1", doc_id: "demo", document: "services-agreement.pdf", page: 2, section: "3. Termination", snippet: "" };
  return (
    <figure className="w-full max-w-md">
      <p className="font-sans text-sm font-medium text-fg-muted">How much notice ends the agreement for convenience?</p>
      <p className="mt-3 font-serif text-xl leading-8 text-fg">
        Either party can end it with <strong className="font-semibold">ninety days' written notice</strong>
        <CitationChip id="S1" citation={cite} />. A material breach allows immediate termination if it isn't fixed within thirty days
        <CitationChip id="S1" citation={cite} />.
      </p>
      <div className="mt-8 rounded-lg border border-line bg-surface p-5">
        <p className="font-mono text-2xs text-fg-subtle">services-agreement.pdf · p. 2 · 3. Termination</p>
        <p className="mt-3 font-serif text-base leading-7 text-fg">
          <mark className="rounded-xs bg-evidence px-0.5 text-fg">
            Either party may terminate this Agreement for convenience on ninety days written notice to the other party.
          </mark>{" "}
          Either party may terminate immediately if the other party commits a material breach…
        </p>
      </div>
      <figcaption className="mt-4 text-xs text-fg-subtle">Every claim links to the page it came from.</figcaption>
    </figure>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginPage() {
  const { token, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { waking } = useWakeState();
  if (token) return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!EMAIL_RE.test(email.trim())) return setError("Enter a valid email address.");
    if (!password) return setError("Enter your password.");
    setLoading(true);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to keep asking your documents questions."
      footer={
        <>
          New to OpenDoc?{" "}
          <Link to="/register" className="inline-flex min-h-11 items-center font-medium text-accent-soft-fg underline-offset-4 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5" noValidate>
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        {error && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2.5 text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
          {loading && waking ? "Waking the server…" : "Sign in"}
        </Button>
      </form>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const { token, register } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { waking } = useWakeState();
  if (token) return <Navigate to="/" replace />;

  const pwBytes = new TextEncoder().encode(password).length;
  const pwError = password && pwBytes < 8 ? "At least 8 characters." : pwBytes > 72 ? "At most 72 bytes." : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!EMAIL_RE.test(email.trim())) return setError("Enter a valid email address.");
    if (pwBytes < 8 || pwBytes > 72) return setError("Password must be 8–72 bytes long.");
    setLoading(true);
    try {
      await register(email, password, fullName);
      navigate("/", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Free and open source. Upload up to 5 documents and get answers that cite the page."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="inline-flex min-h-11 items-center font-medium text-accent-soft-fg underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5" noValidate>
        <Field label="Full name" htmlFor="full_name" hint="Optional">
          <Input id="full_name" autoComplete="name" value={fullName} maxLength={255} onChange={(e) => setFullName(e.target.value)} autoFocus />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" htmlFor="password" hint="8 to 72 characters." error={pwError}>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            aria-invalid={!!pwError}
            aria-describedby={pwError ? "password-error" : "password-hint"}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        {error && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2.5 text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
          {loading && waking ? "Waking the server…" : "Create account"}
        </Button>
      </form>
    </AuthLayout>
  );
}
