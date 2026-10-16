import { test, expect } from '@playwright/test'

test('password unlock protects data, accepts remote hosts and locks again', async ({ page, request }) => {
  expect((await request.get('/api/state')).status()).toBe(401)
  expect((await request.get('/api/backup/download')).status()).toBe(401)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Mở khóa ứng dụng' })).toBeVisible()
  await page.getByLabel('Mật khẩu truy cập').fill('wrong password')
  await page.getByRole('button', { name: 'Mở khóa', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Mật khẩu không đúng')
  await page.getByLabel('Mật khẩu truy cập').fill('browser test password')
  await page.getByRole('button', { name: 'Mở khóa', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Thu Chi', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Thu Chi', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cài đặt', exact: true }).click()
  await page.getByRole('button', { name: 'Khóa ứng dụng', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Mở khóa ứng dụng' })).toBeVisible()
  expect((await page.context().request.get('/api/state')).status()).toBe(401)
})

test('passkey enrollment and login validate an authenticator signature', async ({ page }) => {
  const client = await page.context().newCDPSession(page)
  await client.send('WebAuthn.enable')
  const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  })
  try {
    await page.goto('/')
    await page.getByLabel('Mật khẩu truy cập').fill('browser test password')
    await page.getByRole('button', { name: 'Mở khóa', exact: true }).click()
    await page.getByRole('button', { name: 'Cài đặt', exact: true }).click()
    await page.getByRole('button', { name: 'Thêm passkey', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Đã thêm passkey' })).toBeVisible()
    const credentials = await client.send('WebAuthn.getCredentials', { authenticatorId })
    expect(credentials.credentials).toHaveLength(1)
    await page.getByRole('button', { name: 'Khóa ứng dụng', exact: true }).click()
    await page.getByRole('button', { name: 'Đăng nhập bằng passkey' }).click()
    await expect(page.getByRole('heading', { name: 'Thu Chi', exact: true })).toBeVisible()
    expect((await page.context().request.get('/api/state')).status()).toBe(200)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Thu Chi', exact: true })).toBeVisible()
    await page.context().request.post('/api/auth/logout', { data: {} })
    expect((await page.context().request.get('/api/state')).status()).toBe(401)
    await page.getByRole('button', { name: 'Cài đặt', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Mở khóa ứng dụng' })).toBeVisible()
  } finally {
    await client.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId })
    await client.detach()
  }
})
