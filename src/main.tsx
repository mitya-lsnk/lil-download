import React from "react";
import ReactDOM from "react-dom/client";

import "./theme.css";
// Order matters: skins re-point the theme's variables per [data-skin], and dark
// re-points them again per [data-mode]. Loading theme.css alone (as an earlier
// build did) leaves both pickers switching an attribute nothing listens to.
import "./skins.css";
import "./dark.css";
import "./app.css";
import App from "./App";
import { LangProvider } from "./lib/i18n";
import { SkinProvider } from "./lib/skin";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <LangProvider>
      <SkinProvider>
        <App />
      </SkinProvider>
    </LangProvider>
  </React.StrictMode>,
);
