import { Moon, Sun } from "lucide-react";
import { useState } from "react";

import { currentTheme, setTheme, type Theme } from "@/lib/theme";

export const useTheme = (): [Theme, () => void] => {
  const [theme, set] = useState<Theme>(currentTheme);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    set(next);
  };
  return [theme, toggle];
};

export const ThemeToggle = ({ theme, onToggle }: { theme: Theme; onToggle: () => void }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-label={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
    title={theme === "dark" ? "Modo claro" : "Modo oscuro"}
    className="grid size-10 place-items-center rounded-lg text-rail-ink hover:text-rail-strong"
  >
    {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
  </button>
);
