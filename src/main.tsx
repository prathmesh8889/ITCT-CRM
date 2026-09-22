import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import "./cleanup.css";
import "./lib/teamSync";
import App from "./App.tsx";

try {
  const theme = localStorage.getItem("itct.theme");
  if (theme === "dark" || (!theme && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
    document.documentElement.classList.add("dark");
  }
} catch { /* storage unavailable */ }

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
