import type { SupportedLocale } from '@openvizpilot/shared';

/**
 * Erster Start: Sprache wählen. Bewusst zweisprachig und ohne t() — die Sprache
 * steht ja gerade noch nicht fest. Änderbar später in den Einstellungen.
 */
export function LanguageChooser(props: { onChoose: (locale: SupportedLocale) => void }) {
  return (
    <section class="login-panel language-chooser" aria-labelledby="language-chooser-title">
      <h2 id="language-chooser-title">Sprache wählen · Choose language</h2>
      <div class="language-options">
        <button type="button" lang="de" onClick={() => props.onChoose('de')}>
          Deutsch
        </button>
        <button type="button" lang="en" onClick={() => props.onChoose('en')}>
          English
        </button>
      </div>
      <p class="field-hint">Später in den Einstellungen änderbar · Can be changed later in the settings.</p>
    </section>
  );
}
