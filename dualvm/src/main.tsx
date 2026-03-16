import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./style.css";

export function renderApp(rootElement: HTMLElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

const rootElement = typeof document === "undefined" ? null : document.getElementById("root");
if (rootElement) {
  renderApp(rootElement);
}
