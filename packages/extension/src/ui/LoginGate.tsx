import { t, type AuthConfigResponse, type AuthSession } from '@openvizpilot/shared';
import { LoginPanel as OidcLoginPanel } from '@openvizpilot/ee/extension';
import { useRef, useState } from 'preact/hooks';
import { loginLocal } from '../chat/auth-session';

/** Pflichtfeld-Prüfung für die lokale Anmeldung — pur, damit sie ohne
 * Rendering testbar ist (UI-Review P2-8). */
export function getLoginFieldErrors(username: string, password: string): { username?: string; password?: string } {
  const errors: { username?: string; password?: string } = {};
  if (!username.trim()) errors.username = t('login.usernameRequired');
  if (!password) errors.password = t('login.passwordRequired');
  return errors;
}

/**
 * Login-Gate der Extension: Open Core = Benutzername/Passwort (Konten aus der
 * Admin-UI), Enterprise = Single Sign-On per Popup (ee/). Ersetzt den Chat,
 * bis eine gültige Sitzung vorliegt.
 */
export function LoginGate(props: { baseUrl: string; config: AuthConfigResponse; onLoggedIn: (session: AuthSession) => void }) {
  if (props.config.mode === 'oidc') {
    return <OidcLoginPanel baseUrl={props.baseUrl} config={props.config} onLoggedIn={props.onLoggedIn} />;
  }
  return <LocalLogin baseUrl={props.baseUrl} error={props.config.error} onLoggedIn={props.onLoggedIn} />;
}

function LocalLogin(props: { baseUrl: string; error?: string; onLoggedIn: (session: AuthSession) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Feldbezogene Pflichtfeld-Fehler statt eines stillen return bei leeren
  // Zugangsdaten (UI-Review P2-8).
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({});
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const submit = async (e: Event) => {
    e.preventDefault();
    const nextFieldErrors = getLoginFieldErrors(username, password);
    setFieldErrors(nextFieldErrors);
    if (nextFieldErrors.username) {
      usernameRef.current?.focus();
      return;
    }
    if (nextFieldErrors.password) {
      passwordRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      props.onLoggedIn(await loginLocal(props.baseUrl, username.trim(), password));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="login-panel" onSubmit={(e) => void submit(e)} noValidate>
      <h2>{t('login.required')}</h2>
      <p class="memory-hint">{t('login.localHint')}</p>
      <label>
        {t('login.username')}
        <input
          ref={usernameRef}
          type="text"
          value={username}
          autocomplete="username"
          required
          aria-invalid={fieldErrors.username ? 'true' : undefined}
          aria-describedby={fieldErrors.username ? 'login-username-error' : undefined}
          onInput={(e) => {
            setUsername((e.target as HTMLInputElement).value);
            setFieldErrors((f) => (f.username ? { ...f, username: undefined } : f));
          }}
        />
        {fieldErrors.username && (
          <span id="login-username-error" class="field-error">
            {fieldErrors.username}
          </span>
        )}
      </label>
      <label>
        {t('login.password')}
        <input
          ref={passwordRef}
          type="password"
          value={password}
          autocomplete="current-password"
          required
          aria-invalid={fieldErrors.password ? 'true' : undefined}
          aria-describedby={fieldErrors.password ? 'login-password-error' : undefined}
          onInput={(e) => {
            setPassword((e.target as HTMLInputElement).value);
            setFieldErrors((f) => (f.password ? { ...f, password: undefined } : f));
          }}
        />
        {fieldErrors.password && (
          <span id="login-password-error" class="field-error">
            {fieldErrors.password}
          </span>
        )}
      </label>
      <button type="submit" disabled={busy}>
        {busy ? t('login.submitting') : t('login.submit')}
      </button>
      {(error ?? props.error) && <div class="settings-message" role="alert">{error ?? props.error}</div>}
    </form>
  );
}
