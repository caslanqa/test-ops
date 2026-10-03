import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { setThemePreference, useThemePreference, type ThemePreference } from '../lib/theme';

const OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: 'system', label: 'System theme', icon: Monitor },
  { value: 'light', label: 'Light theme', icon: Sun },
  { value: 'dark', label: 'Dark theme', icon: Moon },
];

/** System / light / dark choice; the selected one is marked with aria-pressed. */
export function ThemeSwitcher() {
  const preference = useThemePreference();
  return (
    <div className="theme-switcher" role="group" aria-label="Theme">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={preference === value}
          aria-label={label}
          title={label}
          onClick={() => setThemePreference(value)}
        >
          <Icon size={16} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
