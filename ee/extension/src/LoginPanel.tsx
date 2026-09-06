import { t } from '@openvizpilot/shared';
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
      <h2>{t('login.required')}</h2>
      <p class="memory-hint">{t('login.oidcHint')}</p>
      {props.config.error ? (
        <div class="settings-message">{props.config.error}</div>
      ) : (
        <button type="button" disabled={busy} onClick={() => void start()}>
          {busy ? t('login.oidcButtonBusy') : t('login.oidcButton', undefined, { provider: label })}
        </button>
      )}
      {error && <div class="settings-message">{error}</div>}
    </div>
  );
}
