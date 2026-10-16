import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Fingerprint, LockKeyhole, Wallet } from 'lucide-react'
import { api, json } from '../lib'
import { accessError, supportsPasskeys, usePasskey, type AccessStatus } from '../access'
import { Button } from './ui/button'

export function AccessGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AccessStatus | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(async () => {
    try {
      setStatus(await api<AccessStatus>('/auth/status'))
      setError('')
    } catch (error) { setError(accessError(error)) }
  }, [])
  useEffect(() => {
    void refresh()
    const lock = () => { setStatus(previous => previous ? { ...previous, authenticated: false } : null); setPassword(''); void refresh() }
    const focus = () => void refresh()
    const timer = window.setInterval(focus, 60000)
    window.addEventListener('access:locked', lock)
    window.addEventListener('focus', focus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('access:locked', lock)
      window.removeEventListener('focus', focus)
    }
  }, [refresh])

  if (status?.authenticated) return children
  async function unlock(passkey: boolean) {
    setBusy(true)
    setError('')
    try {
      if (passkey) await usePasskey()
      else await api('/auth/password', json('POST', { password }))
      setPassword('')
      await refresh()
    } catch (error) { setError(accessError(error)) }
    finally { setBusy(false) }
  }
  return <main className="access-page">
    <section className="access-card" aria-labelledby="access-title">
      <div className="access-brand"><Wallet size={22} /><span>Thu Chi & Thuế</span></div>
      <div className="access-icon"><LockKeyhole size={28} /></div>
      <h1 id="access-title">Mở khóa ứng dụng</h1>
      <p className="muted">Nhập mật khẩu truy cập hoặc sử dụng passkey của bạn.</p>
      {!status ? <><p role="status">{error || 'Đang kết nối…'}</p>{error && <Button onClick={() => void refresh()}>Thử lại</Button>}</> : <>
        <form className="stack" onSubmit={event => { event.preventDefault(); void unlock(false) }}>
          <label className="form-field">Mật khẩu truy cập
            <input type="password" autoComplete="current-password" autoFocus required value={password} onChange={event => setPassword(event.target.value)} disabled={busy} />
          </label>
          {error && <p className="access-error" role="alert">{error}</p>}
          <Button type="submit" disabled={busy || !password}>{busy ? 'Đang xác thực…' : 'Mở khóa'}</Button>
        </form>
        {status.passkey_available && supportsPasskeys() && <Button className="access-passkey" variant="outline" disabled={busy} onClick={() => void unlock(true)}><Fingerprint size={18} />Đăng nhập bằng passkey</Button>}
        <p className="fine muted">Bạn có thể thêm passkey trong Cài đặt sau khi mở khóa.{!window.isSecureContext && ' Mở địa chỉ HTTPS để sử dụng passkey trên điện thoại.'}</p>
      </>}
    </section>
  </main>
}

export function AccessSettings() {
  const [status, setStatus] = useState<AccessStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { api<AccessStatus>('/auth/status').then(status => { setStatus(status); if (!status.authenticated) window.dispatchEvent(new Event('access:locked')) }).catch(error => setError(accessError(error))) }, [])
  return <section className="stack access-settings" aria-label="Truy cập ứng dụng">
    <h3>Truy cập ứng dụng</h3>
    <p className="muted">{status?.passkey_count || 0} passkey đã đăng ký. Mật khẩu truy cập được quản lý trong tệp cấu hình trên máy chủ.</p>
    <div className="access-actions">
      <Button type="button" variant="outline" disabled={busy || !status?.passkey_supported || !supportsPasskeys()} onClick={async () => {
        setBusy(true); setMessage(''); setError('')
        try {
          await usePasskey(true)
          setStatus(await api<AccessStatus>('/auth/status'))
          setMessage('Đã thêm passkey. Lần sau bạn có thể dùng passkey để mở khóa.')
        } catch (error) { setError(accessError(error)) }
        finally { setBusy(false) }
      }}><Fingerprint size={16} />{busy ? 'Đang thêm…' : 'Thêm passkey'}</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={async () => {
        try {
          await api('/auth/logout', json('POST', {}))
          window.dispatchEvent(new Event('access:locked'))
        } catch (error) { setError(accessError(error)) }
      }}>Khóa ứng dụng</Button>
    </div>
    {status && (!status.passkey_supported || !supportsPasskeys()) && <p className="fine muted">Để thêm passkey, mở ứng dụng bằng địa chỉ HTTPS đã cấu hình hoặc localhost.</p>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="access-error">{error}</p>}
  </section>
}
