import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setAuthTokenGetter } from "@workspace/api-client-react";

setAuthTokenGetter(() => {
  return localStorage.getItem("authToken") || null;
});

createRoot(document.getElementById("root")!).render(<App />);
