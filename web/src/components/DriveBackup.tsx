import { useCallback, useEffect, useRef, useState } from 'react'
import { Cloud, ExternalLink, Link, Unplug, Upload } from 'lucide-react'
import { api, json } from '../lib'
import { Button } from './ui/button'

type DriveStatus = {
  configured: boolean
  connected: boolean
  email: string
  redirect_url: string
  connect_origin: string
  can_connect: boolean
  folder_url: string
  last_backup: { name: string; webViewLink: string } | null
  last_backup_at: string
}

export function DriveBackup() {
  const [status, setStatus] = useState<DriveStatus | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [credentials, setCredentials] = useState<unknown>(null)
  const [fileName, setFileName] = useState('')
  const [redirect, setRedirect] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const refresh = useCallback(async () => {
    const next = await api<DriveStatus>('/drive/status')
    setStatus(next)
    setRedirect(current => current || next.redirect_url)
  }, [])
  useEffect(() => { void refresh().catch(error => setError((error as Error).message)) }, [refresh])
  async function action(run: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('')
    try { await run() } catch (error) { setError((error as Error).message) }
    finally { setBusy(false) }
  }
  return <section className="settings-drive stack" aria-labelledby="drive-title">
    <div className="drive-heading"><Cloud size={19} /><h3 id="drive-title">Google Drive</h3></div>
    <p className="fine muted">Lưu bản sao SQLite gồm giao dịch, chứng từ và quy tắc thuế vào thư mục “Thu Chi & Thuế Backups” trên Google Drive của bạn.</p>
    {!status && !error && <p role="status">Đang kiểm tra kết nối…</p>}
    {status?.connected ? <>
      <p className="drive-connected"><span className="dot" />Đã kết nối{status.email ? ' · ' + status.email : ''}</p>
      <div className="backup-actions">
        <Button type="button" disabled={busy} onClick={() => void action(async () => {
          await api('/drive/backup', json('POST', {}))
          await refresh()
          setMessage('Đã sao lưu lên Google Drive và kiểm tra tính toàn vẹn của tệp.')
        })}><Upload size={15} />{busy ? 'Đang xử lý…' : 'Sao lưu lên Google Drive'}</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void action(async () => {
          const result = await api<{ revoked: boolean }>('/drive/disconnect', json('POST', {}))
          await refresh()
          setMessage(result.revoked ? 'Đã ngắt kết nối Google Drive.' : 'Đã ngắt kết nối trên máy chủ. Bạn có thể thu hồi quyền ứng dụng trong tài khoản Google.')
        })}><Unplug size={15} />Ngắt kết nối</Button>
      </div>
      {status.last_backup && <div className="drive-last-backup">
        <span className="fine muted">Bản sao lưu gần nhất · {new Date(status.last_backup_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</span>
        {status.last_backup.webViewLink ? <a href={status.last_backup.webViewLink} target="_blank" rel="noopener noreferrer">{status.last_backup.name}<ExternalLink size={13} /></a> : <span>{status.last_backup.name}</span>}
      </div>}
      {status.folder_url && <a className="drive-folder-link" href={status.folder_url} target="_blank" rel="noopener noreferrer">Mở thư mục sao lưu<ExternalLink size={13} /></a>}
    </> : status && <>
      {status.configured && (status.can_connect ? <Button type="button" variant="outline" disabled={busy} onClick={() => void action(async () => {
        const result = await api<{ url: string }>('/drive/connect', json('POST', {}))
        window.location.assign(result.url)
      })}><Link size={15} />Kết nối Google Drive</Button> : <p className="fine">Để kết nối, mở ứng dụng tại <a href={status.connect_origin + '/?drive=setup'}>{status.connect_origin}</a>. Sau khi kết nối, bạn có thể sao lưu từ mọi thiết bị đã mở khóa.</p>)}
      <details className="drive-setup" open={!status.configured}>
        <summary>{status.configured ? 'Thay đổi thiết lập Google Drive' : 'Thiết lập Google Drive'}</summary>
        <ol className="drive-setup-steps fine muted">
          <li>Tạo project trong Google Cloud và bật Google Drive API.</li>
          <li>Thiết lập Google Auth Platform. Nếu đang ở chế độ Testing, thêm tài khoản của bạn vào Test users trong Audience.</li>
          <li>Tạo OAuth client loại Web application, thêm địa chỉ trả về bên dưới vào Authorized redirect URIs rồi tải tệp JSON của client.</li>
        </ol>
        <p className="fine muted">Chỉ cần thiết lập một lần trên máy chủ. Có thể kết nối trên Mac bằng localhost, sau đó bấm sao lưu từ điện thoại.</p>
        <label className="form-field">Địa chỉ trả về<input type="url" value={redirect} onChange={event => setRedirect(event.target.value)} disabled={busy} /></label>
        <div className="drive-setup-file"><Button type="button" variant="outline" disabled={busy} onClick={() => input.current?.click()}><Upload size={15} />Chọn tệp OAuth client</Button><span className="fine muted">{fileName || 'Tệp JSON tải từ Google Cloud'}</span></div>
        <input ref={input} type="file" accept="application/json,.json" hidden onChange={async event => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (!file) return
          setError(''); setCredentials(null); setFileName('')
          try {
            if (file.size > 65536) throw new Error('Tệp OAuth client tối đa 64 KB.')
            const value = JSON.parse(await file.text())
            if (!value.web?.client_id || !value.web?.client_secret) throw new Error('Hãy chọn tệp OAuth client loại Web application.')
            setCredentials(value); setFileName(file.name)
            const origins: string[] = value.web.redirect_uris || []
            if (origins.length && !origins.includes(redirect)) setRedirect(origins[0])
          } catch (error) { setError((error as Error).message) }
        }} />
        <Button type="button" disabled={busy || !credentials || !redirect} onClick={() => void action(async () => {
          await api('/drive/config', json('PUT', { credentials, redirect_url: redirect }))
          setCredentials(null); setFileName('')
          await refresh()
          setMessage('Đã lưu thiết lập. Bấm Kết nối Google Drive để cấp quyền sao lưu.')
        })}>Lưu thiết lập Google Drive</Button>
        <a className="drive-folder-link" href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noopener noreferrer">Mở Google Cloud<ExternalLink size={13} /></a>
      </details>
    </>}
    {message && <p className="fine" role="status">{message}</p>}
    {error && <p className="fine access-error" role="alert">{error}</p>}
    {!status && error && <Button type="button" variant="outline" onClick={() => void action(refresh)}>Thử lại</Button>}
    <p className="fine muted">Chỉ tải lên khi bạn bấm sao lưu. Ứng dụng chỉ xin quyền với tệp do ứng dụng tạo; bản sao lưu không bao gồm mật khẩu và phiên đăng nhập.</p>
  </section>
}
