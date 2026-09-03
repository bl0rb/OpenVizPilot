/**
 * OpenVizPilot Enterprise Edition — Extension-Teil: OIDC-Popup-Login (PKCE)
 * sowie die Personalisierung (User-Memory, gespeicherte eigene Abfragen).
 * Lizenz: ee/LICENSE (proprietär), NICHT PolyForm.
 */
export {
  buildAuthorizationUrl,
  completeRedirectLogin,
  loginWithPopup,
  parseRedirectFragment,
  pkceChallenge,
  REDIRECT_FRAGMENT_KEY,
  type AuthConfig,
  type OidcSession,
} from './oidc-login';
export { LoginPanel } from './LoginPanel';
export { MemoryFactsPanel } from './MemoryFactsPanel';
export { SavedQueriesPanel } from './SavedQueriesPanel';
export { loadPrefs, savePrefs } from './prefs-client';
export {
  addStandardQuestion,
  dashboardPrefsSchema,
  FOCUS_PRESETS,
  MAX_QUESTION_CHARS,
  MAX_STANDARD_QUESTIONS,
  type DashboardPrefs,
} from '../../server/src/personalization-schema';
