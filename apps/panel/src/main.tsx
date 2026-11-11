import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { PreferencesProvider } from "./lib/preferences.tsx";
import "@radix-ui/themes/styles.css";
import "./main.css";
import "./components/mobile-workspace.css";
import { App } from "./App.tsx";
import { Login } from "./pages/Login.tsx";
import { Dashboard } from "./pages/Dashboard.tsx";
import { Providers, ProviderDetail } from "./pages/Providers.tsx";
import { Routing } from "./pages/Routing.tsx";
import { Keys } from "./pages/Keys.tsx";
import { Activity } from "./pages/Activity.tsx";
import { Usage } from "./pages/Usage.tsx";
import { Models } from "./pages/Models.tsx";
import { Settings } from "./pages/Settings.tsx";
import { Quota } from "./pages/Quota.tsx";
import { Tools } from "./pages/Tools.tsx";
import { Audit } from "./pages/Audit.tsx";

const router = createBrowserRouter(
  [
    {
      path: "/",
      element: <App />,
      children: [
        { index: true, element: <Dashboard /> },
        { path: "providers", element: <Providers /> },
        { path: "providers/:providerId", element: <ProviderDetail /> },
        { path: "routing", element: <Routing /> },
        { path: "keys", element: <Keys /> },
        { path: "activity", element: <Activity /> },
        { path: "usage", element: <Usage /> },
        { path: "quota", element: <Quota /> },
        { path: "tools", element: <Tools /> },
        { path: "audit", element: <Audit /> },
        { path: "models", element: <Models /> },
        { path: "settings", element: <Settings /> },
      ],
    },
    { path: "/login", element: <Login /> },
  ],
  { basename: "/panel" },
);

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

createRoot(root).render(
  <StrictMode>
    <PreferencesProvider><RouterProvider router={router} /></PreferencesProvider>
  </StrictMode>,
);
