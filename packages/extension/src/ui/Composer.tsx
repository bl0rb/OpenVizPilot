import { MAX_MESSAGE_CHARS, t, type ChatMode, type SlashCommand } from '@openvizpilot/shared';
import { useMemo, useRef, useState } from 'preact/hooks';
import { CHAT_MODE_ORDER, modeLabelKey, nextChatMode, placeholderKeyForMode } from '../chat/composer-mode';
import { matchSlashCommands } from '../chat/slash-commands';

export function Composer(props: {
  busy: boolean;
  disabled: boolean;
  /** Server-geladene Slash-Befehle (Fallback: DEFAULT_SLASH_COMMANDS) — siehe App.tsx. */
  commands: SlashCommand[];
  /** Fragen vs. Untersuchen (W3) — Zustand liegt in App.tsx (Session). */
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState('');
  const [menuIndex, setMenuIndex] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);
  // Roving-tabindex-Fokus für die Modus-Segmented-Control (role="radiogroup"):
  // Pfeiltasten müssen den DOM-Fokus auf die neu ausgewählte Option verschieben
  // (WAI-ARIA-Radiogroup-Pattern), sonst laufen Checked-Status und Fokus auseinander.
  const modeButtonRefs = useRef<Partial<Record<ChatMode, HTMLButtonElement>>>({});

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
      <div class="mode-switch" role="radiogroup" aria-label={t('composer.modeLabel')}>
        {CHAT_MODE_ORDER.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={props.mode === m}
            tabIndex={props.mode === m ? 0 : -1}
            disabled={props.disabled}
            class={`mode-option${props.mode === m ? ' mode-option-active' : ''}`}
            title={m === 'investigate' ? t('composer.mode.investigateTooltip') : undefined}
            ref={(el: HTMLButtonElement | null) => {
              if (el) modeButtonRefs.current[m] = el;
            }}
            onClick={() => props.onModeChange(m)}
            onKeyDown={(e) => {
              const next = nextChatMode(props.mode, e.key);
              if (next) {
                e.preventDefault();
                props.onModeChange(next);
                modeButtonRefs.current[next]?.focus();
              }
            }}
          >
            {t(modeLabelKey(m))}
          </button>
        ))}
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
