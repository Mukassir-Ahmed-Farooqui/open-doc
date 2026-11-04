import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { UploadProvider } from "@/components/documents/UploadProvider";
import { LoginPage, RegisterPage } from "@/pages/AuthPages";

// Code-split by audience: the marketing page is its own chunk (signed-in users never download it),
// and the authed app (shell + pages) is split off so signed-out visitors don't download it either.
const LandingPage = lazy(() => import("@/pages/landing/LandingPage"));
const AppShell = lazy(() => import("@/components/layout/AppShell").then((m) => ({ default: m.AppShell })));
const DashboardPage = lazy(() => import("@/pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const LibraryPage = lazy(() => import("@/pages/LibraryPage").then((m) => ({ default: m.LibraryPage })));
const DocumentPage = lazy(() => import("@/pages/DocumentPage").then((m) => ({ default: m.DocumentPage })));
const ChatPage = lazy(() => import("@/pages/ChatPage").then((m) => ({ default: m.ChatPage })));
const SettingsPage = lazy(() => import("@/pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage").then((m) => ({ default: m.NotFoundPage })));

const blank = <div className="min-h-dvh bg-bg" />;
const page = (el: ReactNode) => <Suspense fallback={null}>{el}</Suspense>;

function RequireAuth() {
  const { token } = useAuth();
  const location = useLocation();
  if (!token) {
    // Signed-out visitors at "/" get the landing page; every other protected route still goes to /login.
    if (location.pathname === "/")
      return (
        <Suspense fallback={blank}>
          <LandingPage />
        </Suspense>
      );
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return (
    <UploadProvider>
      <Suspense fallback={blank}>
        <Outlet />
      </Suspense>
    </UploadProvider>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={page(<DashboardPage />)} />
          <Route path="documents" element={page(<LibraryPage />)} />
          <Route path="documents/:docId" element={page(<DocumentPage />)} />
          <Route path="chat/:chatId?" element={page(<ChatPage />)} />
          <Route path="settings" element={page(<SettingsPage />)} />
          <Route path="*" element={page(<NotFoundPage />)} />
        </Route>
      </Route>
    </Routes>
  );
}
