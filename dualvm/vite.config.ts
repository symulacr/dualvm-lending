import react from "@vitejs/plugin-react";

export default {
  base: process.env.PUBLIC_BASE_PATH ?? "/",
  plugins: [react()],
  server: {
    host: true,
    port: 4173,
  },
  build: {
    sourcemap: true,
  },
};
