import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// JSDOM does not lay out elements. React Flow needs nonzero measurements to
// expose auto-height nodes (and their buttons/links) to accessibility queries.
Object.defineProperties(HTMLElement.prototype, {
  offsetWidth: { configurable: true, get: () => 1000 },
  offsetHeight: { configurable: true, get: () => 600 },
});

// React Flow reads only m22 while measuring our fixed, unzoomed viewport.
Object.defineProperty(window, "DOMMatrixReadOnly", {
  configurable: true,
  value: class FixedViewportMatrix { readonly m22 = 1; },
});

class ResizeObserverMock implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    queueMicrotask(() => {
      if (!target.isConnected) return;
      this.callback(
        [
          {
            target,
            contentRect: {
              width: 1000,
              height: 600,
              x: 0,
              y: 0,
              top: 0,
              right: 1000,
              bottom: 600,
              left: 0,
              toJSON: () => ({}),
            },
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          },
        ],
        this,
      );
    });
  }

  unobserve() {}

  disconnect() {}
}

Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: ResizeObserverMock,
});

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
});
