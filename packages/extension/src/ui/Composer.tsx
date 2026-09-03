import { MAX_MESSAGE_CHARS, type SlashCommand } from '@openvizpilot/shared';
import { useMemo, useState } from 'preact/hooks';
import { matchSlashCommands } from '../chat/slash-commands';

export function Composer(props: {
  busy: boolean;
  disabled: boolean;
  /** Server-geladene Slash-Befehle (Fallback: DEFAULT_SLASH_COMMANDS) — siehe App.tsx. */
  commands: SlashCommand[];
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
        <div class="slash-menu">
          {menu.map((c, i) => (
            <button
              key={c.name}
              type="button"
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
      <textarea
        value={text}
        disabled={props.disabled}
        placeholder='Frage zum Dashboard… („/" für Befehle)'
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
          Stopp
        </button>
      ) : (
        <button type="button" class="btn-send" disabled={props.disabled || text.trim() === ''} onClick={submit}>
          Senden
        </button>
      )}
    </div>
  );
}
