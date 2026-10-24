import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { App } from "./App.tsx";
import { Login } from "./pages/Login.tsx";
import { Dashboard } from "./pages/Dashboard.tsx";
import { Providers } from "./pages/Providers.tsx";
import { Routing } from "./pages/Routing.tsx";
import { Keys } from "./pages/Keys.tsx";
import { Activity } from "./pages/Activity.tsx";
import { Usage } from "./pages/Usage.tsx";
import { Models } from "./pages/Models.tsx";
import { Settings } from "./pages/Settings.tsx";
import "./main.css";

const router = createBrowserRouter(
  [
    {
      path: "/",
      element: <App />,
      children: [
        { index: true, element: <Dashboard /> },
        { path: "providers", element: <Providers /> },
        { path: "routing", element: <Routing /> },
        { path: "keys", element: <Keys /> },
        { path: "activity", element: <Activity /> },
        { path: "usage", element: <Usage /> },
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
    <RouterProvider router={router} />
  </StrictMode>,
);
