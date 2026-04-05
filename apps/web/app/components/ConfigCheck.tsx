"use client";

import { useEffect } from "react";
import { showToast } from "./Toast";
import { getApiBase } from "@/lib/api";

/**
 * Pings /config-status on mount and fires warning toasts for any missing
 * API keys so the developer knows immediately without hunting uvicorn logs.
 * Renders nothing visible itself — mount once in the root layout.
 */
export default function ConfigCheck() {
  useEffect(() => {
    fetch(`${getApiBase()}/config-status`)
      .then((r) => r.json())
      .then((data: { google_api_key: boolean; browser_use_api_key: boolean }) => {
        if (!data.google_api_key) {
          showToast(
            "GOOGLE_API_KEY is not set. Test case generation, result validation, and the chat Q&A will fall back to heuristics or return errors. Add the key to apps/api/.env.",
            "warning",
          );
        }
        if (!data.browser_use_api_key) {
          showToast(
            "BROWSER_USE_API_KEY is not set. Browser Use Cloud agent is unavailable — runs will use Playwright smoke tests only.",
            "warning",
          );
        }
      })
      .catch(() => {
        // Backend not reachable — surface a clear error instead of silent failure
        showToast(
          "Cannot reach the Kumqat API. Make sure uvicorn is running on port 8000.",
          "error",
        );
      });
  }, []);

  return null;
}
