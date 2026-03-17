import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // React/vendor를 별도 청크로 분리하여 TDZ 방지
          if (id.includes('node_modules')) return 'vendor';
          if (id.includes('components/expert/')) return 'expert';
          if (id.includes('components/admin/')) return 'admin';
          if (id.includes('components/DetailModal') || id.includes('components/CatPanel') || id.includes('components/detail/')) return 'detail';
          if (id.includes('components/ConsultForm')) return 'consult';
          if (id.includes('components/CompareSheet')) return 'compare';
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
