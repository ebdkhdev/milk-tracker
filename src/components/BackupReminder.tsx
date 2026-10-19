import { useFormat } from '#/lib/format'

// Nudge to export when the last backup is old (or there is none yet); the Export button calls the export
// directly in the click, as Safari requires for the share sheet.
export function BackupReminder({ days, onExport, onLater }: { days: number; onExport: () => void; onLater: () => void }) {
  const { t } = useFormat()
  return (
    <div className="install-banner backup-reminder" id="backup-reminder" style={{ display: 'flex' }}>
      <span>{days > 0 ? t('backupOld', { n: days }) : t('backupNone')}</span>
      <div className="banner-actions">
        <button id="backup-now" className="primary" onClick={onExport}>{t('exportBtn')}</button>
        <button id="backup-later" onClick={onLater}>{t('later')}</button>
      </div>
    </div>
  )
}
