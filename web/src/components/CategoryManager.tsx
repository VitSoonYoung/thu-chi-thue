import { Select } from './ui/select'
import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, json, type Category } from '../lib'
import { Button } from './ui/button'
import { Confirm } from './ui/confirm'
const palette = [
  '#249967',
  '#e99a42',
  '#9690c3',
  '#629ac9',
  '#d47b8c',
  '#7e8b91',
]
export function CategoryManager({
  categories,
  refresh,
  startNew,
}: {
  categories: Category[]
  refresh: () => Promise<void>
  startNew: boolean
}) {
  const [editing, setEditing] = useState<Partial<Category> | null>(
    startNew ? { name: '', color: palette[0], kind: 'both' } : null,
  )
  const [deleting, setDeleting] = useState<Category | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!editing) return
    setBusy(true)
    setError('')
    try {
      await api(
        '/categories' + (editing.id ? '/' + editing.id : ''),
        json(editing.id ? 'PUT' : 'POST', {
          name: editing.name,
          color: editing.color,
          kind: editing.kind,
        }),
      )
      await refresh()
      setEditing(null)
      toast.success('Đã lưu danh mục')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="category-manager">
      <div className="category-manager-list">
        {categories.map((c) => (
          <div className="category-manager-row" key={c.id}>
            <i className="dot" style={{ background: c.color }} />
            <div>
              <strong>{c.name}</strong>
              <small>
                {c.kind === 'income'
                  ? 'Khoản thu'
                  : c.kind === 'expense'
                    ? 'Khoản chi'
                    : 'Thu và chi'}{' '}
                · {c.references} giao dịch
              </small>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={'Sửa ' + c.name}
              onClick={() => {
                setEditing(c)
                setError('')
              }}
            >
              <Pencil size={15} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={'Xóa ' + c.name}
              disabled={c.references > 0}
              title={
                c.references > 0
                  ? 'Danh mục đã có giao dịch, kể cả giao dịch đã xóa'
                  : 'Xóa danh mục'
              }
              onClick={() => setDeleting(c)}
            >
              <Trash2 size={15} />
            </Button>
          </div>
        ))}
      </div>
      {editing ? (
        <form className="stack category-editor" onSubmit={save}>
          <h3>{editing.id ? 'Sửa danh mục' : 'Danh mục mới'}</h3>
          <label className="form-field">
            Tên danh mục
            <input
              value={editing.name || ''}
              maxLength={60}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              required
            />
          </label>
          <label className="form-field">
            Loại
            <Select label="Loại" value={editing.kind || 'both'} onValueChange={value => setEditing({ ...editing, kind: value as Category['kind'] })}
              options={[{ value: 'both', label: 'Thu và chi' }, { value: 'income', label: 'Khoản thu' }, { value: 'expense', label: 'Khoản chi' }]} />
          </label>
          <label className="form-field">
            Màu danh mục
            <div className="palette">
              {palette.map((color) => (
                <button
                  type="button"
                  key={color}
                  aria-label={'Chọn màu ' + color}
                  aria-pressed={editing.color === color}
                  style={{ background: color }}
                  onClick={() => setEditing({ ...editing, color })}
                >
                  {editing.color === color && '✓'}
                </button>
              ))}
              <input
                aria-label="Mã màu HEX"
                value={editing.color || ''}
                onChange={(e) =>
                  setEditing({ ...editing, color: e.target.value })
                }
                pattern="#[a-fA-F0-9]{6}"
                required
              />
            </div>
          </label>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditing(null)}
            >
              Hủy
            </Button>
            <Button disabled={busy}>
              {busy ? 'Đang xử lý…' : 'Lưu danh mục'}
            </Button>
          </div>
        </form>
      ) : (
        <Button
          variant="outline"
          onClick={() =>
            setEditing({ name: '', color: palette[0], kind: 'both' })
          }
        >
          <Plus size={15} />
          Thêm danh mục
        </Button>
      )}
      <p className="fine muted">
        Danh mục có giao dịch được giữ lại để bảo toàn lịch sử.
      </p>
      <Confirm
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title="Xóa danh mục?"
        description={'Danh mục “' + deleting?.name + '” sẽ bị xóa.'}
        action="Xóa danh mục"
        busy={busy}
        onConfirm={async () => {
          setBusy(true)
          try {
            await api('/categories/' + deleting?.id, { method: 'DELETE' })
            await refresh()
            setDeleting(null)
            toast.success('Đã xóa danh mục')
          } catch (e) {
            toast.error((e as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      />
    </div>
  )
}
