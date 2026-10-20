import { useEffect, useRef, useState } from 'react'
import { formatTime } from '#/lib/dates'
import type { Feed, MilkType } from '#/lib/db'
import { MilkToggle } from '#/components/AddFeed'
import { NOTE_MAX } from '#/lib/settings'
import { useFormat } from '#/lib/format'

type Props = {
  entries: Feed[]
  editingId: string | null
  onEdit: (id: string | null) => void
  onSave: (entry: Feed, changes: { ml: number; hhmm: string; type?: MilkType; note: string }) => void
  trackMilk: boolean
  onDelete: (id: string) => void
}

export function FeedList({ entries, editingId, trackMilk, onEdit, onSave, onDelete }: Props) {
  const { t, formatAmount } = useFormat()
  return (
    <>
      <p className="section-label">{t('todaysFeeds')}</p>
      <ul className="feed-list" id="feed-list">
        {entries.length === 0 ? (
          <div className="empty">{t('emptyDay')}</div>
        ) : (
          entries.map((e) =>
            editingId === e.id ? (
              <EditItem key={e.id} entry={e} trackMilk={trackMilk} onSave={onSave} onCancel={() => onEdit(null)} />
            ) : (
              <li key={e.id} className="feed-item">
                <div className="left">
                  <span className="amt">{formatAmount(e.ml)}</span>
                  <span className="time">{formatTime(e.time)}</span>
                </div>
                <div className="actions">
                  <button className="edit" onClick={() => onEdit(e.id)}>{t('edit')}</button>
                  <button className="del" onClick={() => onDelete(e.id)}>{t('del')}</button>
                </div>
                {/* type and note on a second line, so amount, time and actions keep one line */}
                {e.type || e.note || e.by ? (
                  <div className="feed-meta">
                    {e.type ? <span className="milk-badge">{t(e.type === 'formula' ? 'milkFormula' : 'milkBreast')}</span> : null}
                    {e.by ? <span className="feed-by">{t('addedBy', { name: e.by })}</span> : null}
                    {e.note ? <span className="feed-note">{e.note}</span> : null}
                  </div>
                ) : null}
              </li>
            ),
          )
        )}
      </ul>
    </>
  )
}

function EditItem({ entry, trackMilk, onSave, onCancel }: { entry: Feed; trackMilk: boolean; onSave: Props['onSave']; onCancel: () => void }) {
  const { t, unitLabel, mlToDisplay, displayToMl } = useFormat()
  const [amount, setAmount] = useState(String(mlToDisplay(entry.ml)))
  const [time, setTime] = useState(formatTime(entry.time))
  const [type, setType] = useState<MilkType | undefined>(entry.type)
  const [note, setNote] = useState(entry.note || '')
  const amtRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    amtRef.current?.focus()
    amtRef.current?.select()
  }, [])

  const save = () => onSave(entry, { ml: displayToMl(parseFloat(amount)), hhmm: time, type, note })

  return (
    <li className="feed-item editing">
      <div className="feed-edit">
        <input
          ref={amtRef}
          type="number"
          inputMode="decimal"
          min="0"
          aria-label={t('amount')}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(ev) => { if (ev.key === 'Enter') save() }}
        />
        <span className="unit-tag">{unitLabel}</span>
        <input type="time" aria-label={t('time')} value={time} onChange={(e) => setTime(e.target.value)} />
        {trackMilk || entry.type ? <MilkToggle value={type} onChange={setType} idPrefix="edit-milk" /> : null}
        <input
          type="text"
          className="feed-note-input"
          aria-label={t('note')}
          placeholder={t('notePlaceholder')}
          maxLength={NOTE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(ev) => { if (ev.key === 'Enter') save() }}
        />
        <button className="save" onClick={save}>{t('save')}</button>
        <button className="cancel" onClick={onCancel}>{t('cancel')}</button>
      </div>
    </li>
  )
}
