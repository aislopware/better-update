import "./app.css";

import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";

import { getRouter } from "./router";

const router = getRouter();
const { queryClient } = router.options.context;
const root = document.querySelector("#root");

if (root) {
  createRoot(root).render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}
