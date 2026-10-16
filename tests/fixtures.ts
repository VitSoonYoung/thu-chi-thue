import { test as base, expect } from '@playwright/test'
export const test = base.extend<{ unlock: void }>({
  unlock: [async ({ page, request }, use) => {
    const data = { password: 'browser test password' }
    expect((await page.context().request.post('/api/auth/password', { data })).ok()).toBe(true)
    expect((await request.post('/api/auth/password', { data })).ok()).toBe(true)
    await use()
  }, { auto: true }],
})
export { expect }
