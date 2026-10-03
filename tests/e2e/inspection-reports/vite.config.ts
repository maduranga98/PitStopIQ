import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const H = `${HERE}mocks`;
export default defineConfig({
  root: HERE,
  plugins: [react()],
  css: { postcss: ROOT },
  server: { port: 5199, host: "127.0.0.1", fs: { strict: false }, historyApiFallback: true } as any,
  appType: "spa",
  resolve: { alias: [
    { find: /^.*\/config\/firebase$/, replacement: `${H}/firebase.ts` },
    { find: /^.*\/contexts\/AuthContext$/, replacement: `${H}/auth.tsx` },
  ] },
});
