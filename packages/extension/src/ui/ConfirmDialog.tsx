import { t } from '@openvizpilot/shared';
import { useEffect, useRef } from 'preact/hooks';

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  resolve: (accepted: boolean) => void;
}

/**
 * Bestätigungsdialog statt window.confirm: Tableau lädt Extensions in einem
 * sandboxed iframe, in dem native Modals je nach Sandbox-Flags still `false`
 * liefern (UI-Review P0). Gleiches Muster wie ServerDataConsentDialog: Fokus
 * auf die sichere Aktion „Abbrechen", Escape = Abbrechen.
 */
export function ConfirmDialog(props: { request: ConfirmRequest | null; onClose: (accepted: boolean) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const open = props.request !== null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      cancelRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  if (!props.request) return null;

  return (
    <dialog
      ref={dialogRef}
      class="server-data-consent confirm-dialog"
      aria-labelledby="confirm-dialog-title"
      onCancel={(event: Event) => {
        event.preventDefault();
        props.onClose(false);
      }}
    >
      <h2 id="confirm-dialog-title">{props.request.title}</h2>
      <p>{props.request.message}</p>
      <div class="dialog-actions">
        <button type="button" class="btn-primary" onClick={() => props.onClose(true)}>
          {props.request.confirmLabel}
        </button>
        <button ref={cancelRef} type="button" class="btn-secondary" onClick={() => props.onClose(false)}>
          {t('common.cancel')}
        </button>
      </div>
    </dialog>
  );
}
