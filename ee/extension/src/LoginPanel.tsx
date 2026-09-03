import { useState } from 'preact/hooks';
import { loginWithPopup, type AuthConfig, type OidcSession } from './oidc-login';

/**
 * Login-Ansicht der Extension im OIDC-Modus — ersetzt den Chat, bis eine
 * verifizierte Sitzung vorliegt. Der Klick ist die User-Geste für das Popup.
 */
export function LoginPanel(props: { baseUrl: string; config: AuthConfig; onLoggedIn: (session: OidcSession) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = props.config.providerLabel ?? 'Single Sign-On';

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const session = await loginWithPopup({ baseUrl: props.baseUrl, config: props.config });
      props.onLoggedIn(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="login-panel">
      <h2>Anmeldung erforderlich</h2>
      <p class="memory-hint">
        Diese Middleware ist mit Single Sign-On abgesichert. Melde dich mit deinem Firmenkonto an — der Chat
        nutzt danach deine Tableau-Berechtigungen wie gewohnt.
      </p>
      {props.config.error ? (
        <div class="settings-message">{props.config.error}</div>
      ) : (
        <button type="button" disabled={busy} onClick={() => void start()}>
          {busy ? 'Anmeldefenster geöffnet …' : `Mit ${label} anmelden`}
        </button>
      )}
      {error && <div class="settings-message">{error}</div>}
    </div>
  );
}
