import { useFormat } from '#/lib/format'

export type ToastMsg = { id: number; text: string; undo?: () => void }

// The live region stays mounted so screen readers announce each new message.
export function Toast({ toast, onDone }: { toast: ToastMsg | null; onDone: () => void }) {
  const { t } = useFormat()
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast ? (
        <div className="toast" key={toast.id} id="toast">
          <span className="toast-text">{toast.text}</span>
          {toast.undo ? (
            <button id="toast-undo" onClick={() => { toast.undo?.(); onDone() }}>{t('undo')}</button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
