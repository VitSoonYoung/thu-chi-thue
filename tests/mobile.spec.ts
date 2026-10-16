import { test, expect } from './fixtures'

test('mobile form renders and saves without randomUUID', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 })
  await page.addInitScript(() => {
    Object.defineProperty(Crypto.prototype, 'randomUUID', { value: undefined })
  })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.locator('#amount')).toBeVisible()
  await page.locator('#amount').fill('+250000')
  await page.getByLabel('Nội dung', { exact: true }).fill('Mobile compatibility test')
  await page.getByRole('button', { name: 'Ghi giao dịch', exact: true }).click()
  await expect(page.getByText('Đã ghi giao dịch', { exact: true })).toBeVisible()
  await expect(page.locator('#amount')).toHaveValue('')
  expect(errors).toEqual([])
})
