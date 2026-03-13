import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/App";

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return React.createElement("div", { style: { padding: 40, textAlign: "center", fontFamily: "sans-serif" } },
        React.createElement("h2", { style: { fontSize: 18, marginBottom: 8 } }, "오류가 발생했습니다"),
        React.createElement("p", { style: { fontSize: 13, color: "#6B7280", marginBottom: 16 } }, String(this.state.error)),
        React.createElement("button", {
          onClick: () => window.location.reload(),
          style: { padding: "10px 24px", fontSize: 14, borderRadius: 8, border: "1px solid #D1D5DB", background: "#F9FAFB", cursor: "pointer" }
        }, "새로고침")
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
