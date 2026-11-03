import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { Logo } from "@/components/layout/Logo";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Input";
import { errorMessage } from "@/lib/api/errors";

function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_at_top,var(--accent-soft),transparent_70%)] opacity-70" aria-hidden />
      <header className="relative px-6 py-5">
        <Logo />
      </header>
      <main className="relative flex flex-1 items-start justify-center px-4 pt-[8vh] pb-16">
        <div className="w-full max-w-sm animate-pop-in">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>
          <div className="mt-6 rounded-xl border border-line bg-surface p-6 shadow-sm">{children}</div>
          <p className="mt-6 text-center text-sm text-fg-muted">{footer}</p>
        </div>
      </main>
    </div>
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
      subtitle="Sign in to ask questions of your documents."
      footer={
        <>
          New to OpenDoc?{" "}
          <Link to="/register" className="font-medium text-accent hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
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
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
          Sign in
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
      subtitle="Upload documents and get answers with page-level citations."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
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
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
