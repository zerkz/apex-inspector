import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import DevtoolsPanel from "./DevtoolsPanel";
import "../global.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DevtoolsPanel />
  </StrictMode>
);
