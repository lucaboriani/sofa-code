/// <reference types="astro/client" />

declare global {
  interface Window {
    __audioBus__?: import('@/lib/audio/bus').AudioBus;
  }
}

export {};
