import { vi } from 'vitest';

// Global WXT and WebExtension polyfills for Vitest unit testing
if (typeof (globalThis as Record<string, unknown>).defineBackground === 'undefined') {
  (globalThis as Record<string, unknown>).defineBackground = (fn: () => void) => fn;
}

if (typeof (globalThis as Record<string, unknown>).browser === 'undefined') {
  (globalThis as Record<string, unknown>).browser = {
    sidePanel: {
      setPanelBehavior: vi.fn().mockResolvedValue(undefined),
    },
    runtime: {
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    tabs: {
      query: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      onActivated: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      onUpdated: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
  };
}
