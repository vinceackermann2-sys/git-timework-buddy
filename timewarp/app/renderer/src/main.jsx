import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";

// Platform-specific layout, such as room for the macOS window buttons.
document.documentElement.dataset.platform = window.tw?.platform || "";
createRoot(document.getElementById("root")).render(<App />);
