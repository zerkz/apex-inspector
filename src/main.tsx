import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./global.css";


createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="bg-white w-[600px] h-[500px]"></div>
  </StrictMode>
); 
 