// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { ar, en } from "./i18n";

declare const jsdom: { window: Pick<Window, "localStorage"> };

const mobileQuery = "(max-width: 640px)";
const darkQuery = "(prefers-color-scheme: dark)";
type ChangeListener = (event: MediaQueryListEvent) => void;
const mobileListeners = new Set<ChangeListener>();
let mobile = true;
let systemDark = false;

function setViewport(next: boolean) {
  act(() => {
    mobile = next;
    const event = { matches: next, media: mobileQuery } as MediaQueryListEvent;
    for (const listener of mobileListeners) listener(event);
  });
}

beforeEach(() => {
  mobile = true;
  systemDark = false;
  mobileListeners.clear();
  vi.stubGlobal("localStorage", jsdom.window.localStorage);
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ agent: "disabled" })));
  vi.stubGlobal("matchMedia", (query: string) => {
    const listeners = query === mobileQuery ? mobileListeners : new Set<ChangeListener>();
    return {
      media: query,
      get matches() { return query === mobileQuery ? mobile : query === darkQuery && systemDark; },
      addEventListener: (_type: string, listener: ChangeListener) => { listeners.add(listener); },
      removeEventListener: (_type: string, listener: ChangeListener) => { listeners.delete(listener); },
      addListener: (listener: ChangeListener) => { listeners.add(listener); },
      removeListener: (listener: ChangeListener) => { listeners.delete(listener); },
    };
  });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><App /></MemoryRouter></QueryClientProvider>);
}

it("opens the mobile sidebar, exposes its state and restores focus on Escape", () => {
  mount();
  const toggle = screen.getByRole("button", { name: en.mobileMenu });
  const sidebar = document.getElementById("main-sidebar")!;
  const main = document.querySelector(".main-shell")!;
  expect(toggle.getAttribute("aria-controls")).toBe(sidebar.id);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(sidebar.hasAttribute("inert")).toBe(true);

  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(sidebar.classList.contains("open")).toBe(true);
  expect(sidebar.hasAttribute("inert")).toBe(false);
  expect(main.hasAttribute("inert")).toBe(true);
  const first = within(sidebar).getByRole("link", { name: en.home });
  expect(document.activeElement).toBe(first);

  fireEvent.keyDown(first, { key: "Escape" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(sidebar.hasAttribute("inert")).toBe(true);
  expect(main.hasAttribute("inert")).toBe(false);
  expect(document.activeElement).toBe(toggle);
});

it("closes the mobile menu when the viewport grows and does not reopen when it shrinks", () => {
  mount();
  const toggle = screen.getByRole("button", { name: en.mobileMenu });
  const sidebar = document.getElementById("main-sidebar")!;
  fireEvent.click(toggle);
  expect(document.querySelector(".mobile-scrim")).toBeTruthy();

  setViewport(false);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(sidebar.hasAttribute("inert")).toBe(false);
  expect(document.querySelector(".mobile-scrim")).toBeNull();
  expect(document.querySelector(".main-shell")!.hasAttribute("inert")).toBe(false);

  setViewport(true);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(sidebar.hasAttribute("inert")).toBe(true);
  expect(document.querySelector(".mobile-scrim")).toBeNull();
});

it("keeps Arabic RTL navigation and closes the mobile menu on backdrop and navigation", () => {
  localStorage.setItem("aetheris.lang", "ar");
  mount();
  const toggle = screen.getByRole("button", { name: ar.mobileMenu });
  const sidebar = document.getElementById("main-sidebar")!;
  expect(document.documentElement.dir).toBe("rtl");
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole("button", { name: ar.close }));
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(toggle);
  fireEvent.click(within(sidebar).getByRole("link", { name: ar.home }));
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
});

it("falls back to the system theme for an invalid saved preference and preserves manual switching", () => {
  localStorage.setItem("aetheris.theme", "unexpected");
  systemDark = true;
  mount();
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(localStorage.getItem("aetheris.theme")).toBe("system");
  fireEvent.click(screen.getByRole("button", { name: en.switchToLight }));
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(localStorage.getItem("aetheris.theme")).toBe("light");
});
