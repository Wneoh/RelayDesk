import { useState } from 'react';
import { Monitor, Moon, Sun, SunMoon, Check } from 'lucide-react';
import { Modal } from './components';
type Theme = 'light' | 'dark' | 'system';
const key = 'relaydesk:theme';
function savedTheme(): Theme {
  try {
    const v = localStorage.getItem(key);
    return v === 'dark' || v === 'light' ? v : 'system';
  } catch {
    return 'system';
  }
}
function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme =
    theme === 'system'
      ? matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;
  window.dispatchEvent(new Event('relaydesk:appearance'));
}
export function initializeAppearance() {
  applyTheme(savedTheme());
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (savedTheme() === 'system') applyTheme('system');
  });
  window.addEventListener('storage', (e) => {
    if (e.key === key) applyTheme(savedTheme());
  });
}
export function Appearance() {
  const [open, setOpen] = useState(false),
    [theme, setTheme] = useState<Theme>(savedTheme);
  function change(value: Theme) {
    setTheme(value);
    try {
      localStorage.setItem(key, value);
    } catch {
      /* The current tab still applies the preference. */
    }
    applyTheme(value);
  }
  return (
    <>
      <button
        className="icon-button appearance-trigger"
        aria-label="Change appearance"
        title="Change appearance"
        onClick={() => {
          setTheme(savedTheme());
          setOpen(true);
        }}
      >
        <SunMoon size={19} />
      </button>
      {open && (
        <Modal title="Appearance" onClose={() => setOpen(false)}>
          <p className="appearance-intro">
            Choose the look that works for you. Your preference is saved in this browser.
          </p>
          <fieldset className="theme-choices">
            <legend>Color theme</legend>
            {[
              {
                value: 'light',
                label: 'Light',
                detail: 'Bright surfaces with high contrast text.',
                Icon: Sun,
              },
              {
                value: 'dark',
                label: 'Dark',
                detail: 'Dark surfaces with readable, softer highlights.',
                Icon: Moon,
              },
              {
                value: 'system',
                label: 'System',
                detail: 'Follow your device’s appearance setting.',
                Icon: Monitor,
              },
            ].map((t) => (
              <label
                key={t.value}
                className={`theme-choice ${theme === t.value ? 'selected' : ''}`}
              >
                <input
                  type="radio"
                  name="color-theme"
                  value={t.value}
                  checked={theme === t.value}
                  onChange={() => change(t.value as Theme)}
                />
                <t.Icon size={23} />
                <span>
                  <strong>{t.label}</strong>
                  <small>{t.detail}</small>
                </span>
                {theme === t.value && <Check size={18} />}
              </label>
            ))}
          </fieldset>
          <div className="appearance-done">
            <button className="button primary" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
