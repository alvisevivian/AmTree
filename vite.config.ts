import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { proxy: { "/api/mission-window": "http://127.0.0.1:4194" } },
});
