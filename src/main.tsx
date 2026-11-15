import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installBrowserRuntime } from "./browserRuntime";

try {
  await installBrowserRuntime();
} catch (error) {
  const root = document.getElementById("root")!;
  root.textContent = error instanceof Error ? error.message : "Unable to initialize AmTree. Reload and try again.";
  throw error;
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
