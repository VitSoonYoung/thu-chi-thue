import { test, expect } from './fixtures'
import { mkdir } from 'node:fs/promises'

test('theme toggle persists and dark layouts fit desktop and phone', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('heading', { name: 'Báo Cáo', exact: true }).waitFor()
  const root = page.locator('html')
  if (await root.getAttribute('data-theme') === 'dark') await page.getByRole('button', { name: 'Chuyển sang giao diện sáng' }).click()
  const toggle = page.getByRole('button', { name: 'Chuyển sang giao diện tối' })
  const settings = page.getByRole('button', { name: 'Cài đặt', exact: true })
  expect(await toggle.evaluate((element) => element.nextElementSibling?.getAttribute('aria-label'))).toBe('Cài đặt')
  await toggle.click()
  await expect(root).toHaveAttribute('data-theme', 'dark')
  expect(await page.evaluate(() => localStorage.getItem('thuchithue_theme'))).toBe('dark')
  await page.reload()
  await expect(root).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('heading', { name: 'Báo Cáo', exact: true }).waitFor()
  await mkdir('.tmp', { recursive: true })
  await page.setViewportSize({ width: 1440, height: 1040 })
  await page.screenshot({ path: '.tmp/dark-desktop.png', fullPage: true })
  await settings.click()
  await expect(page.getByRole('heading', { name: 'Google Drive', exact: true })).toBeVisible()
  await page.screenshot({ path: '.tmp/dark-settings.png', fullPage: true })
  await page.getByRole('dialog', { name: 'Cài đặt', exact: true }).getByRole('button', { name: 'Đóng', exact: true }).click()
  await page.setViewportSize({ width: 375, height: 812 })
  await page.screenshot({ path: '.tmp/dark-mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Chuyển sang giao diện sáng' }).click()
  await expect(root).toHaveAttribute('data-theme', 'light')
})

test('Drive controls configure a client and initiate OAuth without leaking secrets', async ({ page }) => {
  let configured = false
  await page.route('**/api/drive/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/status')) return route.fulfill({ json: { configured, connected: false, email: '', redirect_url: 'http://localhost:8081/api/drive/callback', connect_origin: 'http://localhost:8081', can_connect: true, folder_url: '', last_backup: null, last_backup_at: '' } })
    if (path.endsWith('/config')) {
      const body = route.request().postDataJSON()
      expect(body.credentials.web.client_secret).toBe('fake client secret')
      expect(body.redirect_url).toBe('http://localhost:8081/api/drive/callback')
      configured = true
      return route.fulfill({ json: { configured: true } })
    }
    throw new Error('Unexpected Drive request: ' + path)
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Cài đặt', exact: true }).click()
  const section = page.getByRole('region', { name: 'Google Drive', exact: true })
  await expect(section.getByText('Thiết lập Google Drive', { exact: true })).toBeVisible()
  const chooser = page.waitForEvent('filechooser')
  await section.getByRole('button', { name: 'Chọn tệp OAuth client' }).click()
  await (await chooser).setFiles({ name: 'client.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ web: { client_id: 'fake.apps.googleusercontent.com', client_secret: 'fake client secret', redirect_uris: ['http://localhost:8081/api/drive/callback'] } })) })
  await section.getByRole('button', { name: 'Lưu thiết lập Google Drive' }).click()
  await expect(section.getByRole('button', { name: 'Kết nối Google Drive' })).toBeVisible()
  await expect(section).not.toContainText('fake client secret')
})

test('Drive backup controls show successful upload metadata and disconnect', async ({ page }) => {
  let connected = true, uploaded = false
  await page.route('**/api/drive/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/status')) return route.fulfill({ json: { configured: true, connected, email: connected ? 'owner@example.com' : '', redirect_url: 'http://localhost:8081/api/drive/callback', connect_origin: 'http://localhost:8081', can_connect: true, folder_url: '', last_backup: uploaded && connected ? { name: 'backup.db', webViewLink: 'https://drive.google.com/file/d/test/view' } : null, last_backup_at: '2026-10-16T13:00:00Z' } })
    if (path.endsWith('/backup')) { uploaded = true; return route.fulfill({ json: { file: { name: 'backup.db' } } }) }
    if (path.endsWith('/disconnect')) { connected = false; return route.fulfill({ json: { disconnected: true, revoked: true } }) }
    throw new Error('Unexpected Drive request: ' + path)
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Cài đặt', exact: true }).click()
  const section = page.getByRole('region', { name: 'Google Drive', exact: true })
  await expect(section).toContainText('owner@example.com')
  await section.getByRole('button', { name: 'Sao lưu lên Google Drive' }).click()
  await expect(section.getByRole('status')).toContainText('Đã sao lưu lên Google Drive')
  await expect(section.getByRole('link', { name: 'backup.db' })).toHaveAttribute('href', 'https://drive.google.com/file/d/test/view')
  await section.getByRole('button', { name: 'Ngắt kết nối' }).click()
  await expect(section.getByRole('button', { name: 'Kết nối Google Drive' })).toBeVisible()
})
