import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          expert: [
            "./src/components/expert/ExpertDashboard.jsx",
            "./src/components/expert/ExpertFieldTable.jsx",
            "./src/components/expert/ExpertScoreBreakdown.jsx",
            "./src/components/expert/ExpertScoreSummary.jsx",
            "./src/components/expert/ExpertUnitPlaceholder.jsx",
            "./src/components/expert/ExpertDataCompleteness.jsx",
            "./src/components/expert/ExpertSidebar.jsx",
            "./src/components/expert/ExpertAptHeader.jsx",
          ],
          admin: ["./src/components/admin/AdminDashboard.jsx"],
          detail: ["./src/components/DetailModal.jsx", "./src/components/CatPanel.jsx", "./src/components/detail/PriceTable.jsx", "./src/components/detail/SchoolInfo.jsx", "./src/components/detail/LoanAnalysis.jsx", "./src/components/detail/DataSections.jsx"],
          consult: ["./src/components/ConsultForm.jsx"],
          compare: ["./src/components/CompareSheet.jsx"],
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
