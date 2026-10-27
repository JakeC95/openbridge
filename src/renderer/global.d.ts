import type { OpenBridgeApi } from "../shared/types";

declare global {
  interface Window {
    openbridge: OpenBridgeApi;
  }
}

export {};
