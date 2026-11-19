/// <reference types="vite/client" />

import type { SafeScreenApi } from "@shared/contracts";

declare global {
  interface Window {
    safeScreen: SafeScreenApi;
  }
}

export {};
