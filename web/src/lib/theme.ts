// Light or dark, following the system until I pick one; the choice stays in this browser only.

export type Theme = "light" | "dark";

// Also read by the inline script in index.html, which applies it before the first paint.
const STORAGE_KEY = "jarvis-theme";

export const currentTheme = (): Theme => (document.documentElement.classList.contains("dark") ? "dark" : "light");

export const setTheme = (theme: Theme): void => {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private mode: the choice lasts this page only.
  }
};
