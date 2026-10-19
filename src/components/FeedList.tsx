import { useEffect, useRef, useState } from 'react'
import { formatTime } from '#/lib/dates'
import type { Feed } from '#/lib/db'
import { useFormat } from '#/lib/format'

type Props = {
  entries: Feed[]
  editingId: string | null
  onEdit: (id: string | null) => void
  onSave: (entry: Feed, ml: number, hhmm: string) => void
  onDelete: (id: string) => void
}

export function FeedList({ entries, editingId, onEdit, onSave, onDelete }: Props) {
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
              <EditItem key={e.id} entry={e} onSave={onSave} onCancel={() => onEdit(null)} />
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
              </li>
            ),
          )
        )}
      </ul>
    </>
  )
}

function EditItem({ entry, onSave, onCancel }: { entry: Feed; onSave: Props['onSave']; onCancel: () => void }) {
  const { t, unitLabel, mlToDisplay, displayToMl } = useFormat()
  const [amount, setAmount] = useState(String(mlToDisplay(entry.ml)))
  const [time, setTime] = useState(formatTime(entry.time))
  const amtRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    amtRef.current?.focus()
    amtRef.current?.select()
  }, [])

  const save = () => onSave(entry, displayToMl(parseFloat(amount)), time)

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
        <button className="save" onClick={save}>{t('save')}</button>
        <button className="cancel" onClick={onCancel}>{t('cancel')}</button>
      </div>
    </li>
  )
}
