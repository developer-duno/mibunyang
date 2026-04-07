import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  build: {
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](react|react-dom)[\\/]/.test(id)) {
            return 'vendor';
          }
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "https://www.xn--hg3bi2ac4o1ig57cnoa.com",
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
