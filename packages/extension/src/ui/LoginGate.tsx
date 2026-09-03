import type { AuthConfigResponse, AuthSession } from '@openvizpilot/shared';
import { LoginPanel as OidcLoginPanel } from '@openvizpilot/ee/extension';
import { useState } from 'preact/hooks';
import { loginLocal } from '../chat/auth-session';

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

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
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
    <form class="login-panel" onSubmit={(e) => void submit(e)}>
      <h2>Anmeldung erforderlich</h2>
      <p class="memory-hint">Bitte mit dem Benutzerkonto anmelden, das dein Administrator für OpenVizPilot angelegt hat.</p>
      <label>
        Benutzername
        <input type="text" value={username} autocomplete="username" onInput={(e) => setUsername((e.target as HTMLInputElement).value)} />
      </label>
      <label>
        Passwort
        <input type="password" value={password} autocomplete="current-password" onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? 'Anmelden …' : 'Anmelden'}
      </button>
      {(error ?? props.error) && <div class="settings-message">{error ?? props.error}</div>}
    </form>
  );
}
