import { Toaster } from "sonner";
import { useTheme } from "@/theme/ThemeProvider";

export function ThemedToaster() {
  const { resolved } = useTheme();
  return <Toaster theme={resolved} position="bottom-right" toastOptions={{ className: "!font-sans" }} />;
}
