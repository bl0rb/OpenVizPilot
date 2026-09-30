import { MAX_MESSAGE_CHARS, t, type ChatMode, type SlashCommand } from '@openvizpilot/shared';
import { useMemo, useState } from 'preact/hooks';
import {
  isInvestigateMode,
  placeholderKeyForMode,
  toggleEstateScope,
  toggleInvestigate,
} from '../chat/composer-mode';
import { matchSlashCommands } from '../chat/slash-commands';

export function Composer(props: {
  busy: boolean;
  disabled: boolean;
  /** Server-geladene Slash-Befehle (Fallback: DEFAULT_SLASH_COMMANDS) — siehe App.tsx. */
  commands: SlashCommand[];
  /** Fragen vs. Untersuchen (W3) — Zustand liegt in App.tsx (Session). */
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  /** Nur mit Lizenz + Freigabe (features.serverData) zeigt der Composer den Umfangs-Schalter (W7 Punkt 6). */
  serverDataAvailable?: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState('');
  const [menuIndex, setMenuIndex] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);

  // Slash-Menü: sichtbar, solange nur der Befehlsname getippt wird
  // (bis zum ersten Leerzeichen) und es passende Befehle gibt.
  const menu = useMemo(() => {
    if (menuDismissed || props.busy || !text.startsWith('/') || /\s/.test(text)) return [];
    return matchSlashCommands(props.commands, text);
  }, [text, menuDismissed, props.busy, props.commands]);

  const updateText = (value: string) => {
    setText(value);
    setMenuIndex(0);
    setMenuDismissed(false);
  };

  const completeCommand = (name: string) => {
    updateText(`/${name} `);
  };

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || props.busy || props.disabled) return;
    setText('');
    props.onSend(trimmed);
  };

  return (
    <div class="composer">
      {menu.length > 0 && (
        <div class="slash-menu" id="composer-slash-menu" role="listbox" aria-label={t('composer.slashMenuLabel')}>
          {menu.map((c, i) => (
            <button
              key={c.name}
              id={`slash-option-${i}`}
              type="button"
              role="option"
              aria-selected={i === menuIndex}
              class={`slash-item${i === menuIndex ? ' slash-item-active' : ''}`}
              onMouseEnter={() => setMenuIndex(i)}
              onClick={() => completeCommand(c.name)}
            >
              <span class="slash-name">
                /{c.name}
                {c.argHint && <span class="slash-arg"> {c.argHint}</span>}
              </span>
              <span class="slash-desc">{c.description}</span>
            </button>
          ))}
        </div>
      )}
      <div class="mode-switch-row">
        <button
          type="button"
          role="switch"
          aria-checked={isInvestigateMode(props.mode)}
          disabled={props.disabled}
          class="mode-toggle"
          title={t('composer.mode.investigateTooltip')}
          onClick={() => props.onModeChange(toggleInvestigate(props.mode))}
        >
          <span class="mode-toggle-track" aria-hidden="true" />
          <span class="mode-toggle-label">{t('composer.mode.investigate')}</span>
        </button>
        {props.serverDataAvailable && (
          // Untersuchungs-Umfang (W7 Punkt 6): nur mit Lizenz + Freigabe
          // (features.serverData); grau, solange Untersuchen aus ist.
          <button
            type="button"
            role="switch"
            aria-checked={props.mode === 'investigate-estate'}
            disabled={props.disabled || !isInvestigateMode(props.mode)}
            class="mode-toggle"
            title={t('composer.scope.estateTooltip')}
            onClick={() => props.onModeChange(toggleEstateScope(props.mode))}
          >
            <span class="mode-toggle-track" aria-hidden="true" />
            <span class="mode-toggle-label">{t('composer.scope.estate')}</span>
          </button>
        )}
      </div>
      <div class="composer-input-row">
        <textarea
          value={text}
          disabled={props.disabled}
          placeholder={t(placeholderKeyForMode(props.mode))}
          aria-label={t(placeholderKeyForMode(props.mode))}
          role="combobox"
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-expanded={menu.length > 0}
          aria-controls="composer-slash-menu"
          aria-activedescendant={menu.length > 0 ? `slash-option-${menuIndex}` : undefined}
          rows={2}
          maxLength={MAX_MESSAGE_CHARS}
          onInput={(e) => updateText((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (menu.length > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setMenuIndex((i) => (i + 1) % menu.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setMenuIndex((i) => (i - 1 + menu.length) % menu.length);
                return;
              }
              if (e.key === 'Tab' || e.key === 'Enter') {
                e.preventDefault();
                const chosen = menu[menuIndex] ?? menu[0];
                if (chosen) completeCommand(chosen.name);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setMenuDismissed(true);
                return;
              }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {props.busy ? (
          <button type="button" class="btn-stop" onClick={props.onStop}>
            {t('composer.stop')}
          </button>
        ) : (
          <button type="button" class="btn-send" disabled={props.disabled || text.trim() === ''} onClick={submit}>
            {t('composer.send')}
          </button>
        )}
      </div>
    </div>
  );
}
