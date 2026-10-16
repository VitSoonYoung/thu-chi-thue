import { test, expect } from './fixtures'
import { mkdir } from 'node:fs/promises'

test('year navigation and daily activity link to the matching transactions', async ({ page, request }) => {
  const state = await (await request.get('/api/state')).json()
  const year = Number(state.today.slice(0, 4))
  const ids: number[] = []
  const entries = [
    { amount: '1000', category_id: 1, date: `${year}-02-03`, note: 'Activity income' },
    { amount: '-200', category_id: 2, date: `${year}-02-03`, note: 'Activity expense' },
    { amount: '-300', category_id: 2, date: `${year}-02-04`, note: 'Activity negative day' },
    { amount: '500', category_id: 1, date: `${year - 1}-08-15`, note: 'Activity previous year' },
  ]
  try {
    for (const entry of entries) {
      const result = await request.post('/api/transactions', { multipart: { data: JSON.stringify({ ...entry, deductible: false, request_id: 'activity_' + crypto.randomUUID(), remove: [] }) } })
      expect(result.ok()).toBe(true)
      ids.push((await result.json()).id)
    }
    await page.setViewportSize({ width: 1280, height: 994 })
    await page.goto('/')
    const history = page.getByRole('region', { name: /^Giao dịch gần đây/ })
    const nav = page.getByRole('navigation', { name: 'Chọn tháng giao dịch gần đây' })
    await expect(nav.getByRole('button', { name: new RegExp(`^Tháng \\d+ năm ${year}$`) })).toHaveCount(12)
    await expect(nav.getByRole('button', { name: 'Về hiện tại' })).toHaveCount(0)
    await nav.getByRole('button', { name: `Xem năm ${year - 1}` }).click()
    await nav.getByRole('button', { name: `Tháng 8 năm ${year - 1}`, exact: true }).click()
    await expect(history.getByRole('heading')).toHaveText(`Giao dịch gần đây • Tháng 8/${year - 1}`)
    await expect(history.getByRole('button', { name: 'Mở giao dịch Activity previous year' })).toBeVisible()
    await expect(nav.getByRole('button', { name: new RegExp(`^Tháng \\d+ năm ${year}$`) })).toHaveCount(0)
    await nav.getByRole('button', { name: 'Về hiện tại' }).click()
    await expect(history.getByRole('heading')).toHaveText(`Giao dịch gần đây • Tháng ${Number(state.today.slice(5, 7))}/${year}`)

    const activity = page.getByRole('region', { name: 'Thu chi từng ngày' })
    const count = new Date(Date.UTC(year + 1, 0, 1)).getTime() - new Date(Date.UTC(year, 0, 1)).getTime()
    await expect(activity.locator('.activity-day')).toHaveCount(count / 86400000)
    const positive = activity.locator(`[data-date="${year}-02-03"]`)
    const negative = activity.locator(`[data-date="${year}-02-04"]`)
    await expect(positive).toHaveClass(/activity-positive/)
    await expect(negative).toHaveClass(/activity-negative/)
    await positive.hover()
    const tooltip = page.getByRole('tooltip')
    await expect(tooltip).toContainText(`03/02/${year}`)
    await expect(tooltip).toContainText('Activity income')
    await expect(tooltip).toContainText('Activity expense')
    await expect(tooltip).toContainText('+800 ₫')
    await mkdir('.tmp', { recursive: true })
    await page.screenshot({ path: '.tmp/activity-tooltip.png', fullPage: true })
    await positive.click()
    await expect(history.getByRole('heading')).toHaveText(`Giao dịch gần đây • Tháng 2/${year}`)
    await expect(history.locator('.transaction-highlighted')).toHaveCount(2)
    await expect(history.locator('.transaction-highlighted').first()).toBeInViewport()
    await expect(page.getByLabel('Chọn kỳ báo cáo')).toHaveValue(`${year}-02`)
    await expect(positive).toHaveAttribute('aria-pressed', 'true')
    const geometry = await page.locator('.report-period').evaluate(element => {
      const children = Array.from(element.children).map(child => child.getBoundingClientRect())
      return children[0].right < children[1].left && children[1].right < children[2].left && children[1].width > children[0].width
    })
    expect(geometry).toBe(true)
    await mkdir('.tmp', { recursive: true })
    await page.screenshot({ path: '.tmp/activity-desktop.png', fullPage: true })
    await page.setViewportSize({ width: 375, height: 812 })
    await page.screenshot({ path: '.tmp/activity-mobile.png', fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await history.getByRole('button', { name: 'Bỏ chọn ngày' }).click()
    await expect(history.locator('.transaction-highlighted')).toHaveCount(0)
  } finally {
    for (const id of ids) await request.delete('/api/transactions/' + id)
  }
})

test('all time reports include every year and hide the daily calendar', async ({ page, request }) => {
  const before = await (await request.get('/api/state')).json()
  const year = Number(before.today.slice(0, 4))
  const ids: number[] = []
  try {
    for (const entry of [
      { amount: '1000', category_id: 1, date: `${year}-01-15` },
      { amount: '-250', category_id: 2, date: `${year}-01-15` },
      { amount: '2000', category_id: 1, date: `${year - 1}-06-15` },
      { amount: '-500', category_id: 2, date: `${year - 1}-06-15` },
    ]) {
      const result = await request.post('/api/transactions', { multipart: { data: JSON.stringify({ ...entry, note: 'All time report', deductible: false, request_id: 'alltime_' + crypto.randomUUID(), remove: [] }) } })
      expect(result.ok()).toBe(true)
      ids.push((await result.json()).id)
    }
    const state = await (await request.get('/api/state')).json()
    let income = 0n, expense = 0n
    for (const transaction of state.transactions) {
      const amount = BigInt(transaction.amount)
      if (amount > 0n) income += amount
      else expense -= amount
    }
    await page.goto('/')
    const report = page.getByRole('region', { name: 'Báo Cáo', exact: true })
    await report.getByRole('button', { name: 'Tất cả', exact: true }).click()
    await expect(report.getByRole('button', { name: 'Tất cả', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(report.locator('.metric-card').nth(0).locator('.money')).toContainText(income.toLocaleString('vi-VN'))
    await expect(report.locator('.metric-card').nth(1).locator('.money')).toContainText(expense.toLocaleString('vi-VN'))
    await expect(report.locator('.profit-value')).toContainText((income - expense).toLocaleString('vi-VN'))
    await expect(report.getByText('Toàn bộ thời gian')).toBeVisible()
    await expect(report.locator('.daily-activity')).toHaveCount(0)
    await expect(report.getByRole('button', { name: 'Kỳ trước' })).toHaveCount(0)
    await expect(report.getByRole('img', { name: 'Biểu đồ doanh thu và chi tiêu theo năm' })).toBeVisible()
    await page.setViewportSize({ width: 320, height: 812 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await report.getByRole('button', { name: 'Năm', exact: true }).click()
    await expect(report.locator('.daily-activity')).toHaveCount(1)
    await expect(report.getByLabel('Chọn kỳ báo cáo')).toBeVisible()
    await report.getByRole('button', { name: 'Tháng', exact: true }).click()
    await expect(report.getByRole('button', { name: 'Tháng', exact: true })).toHaveAttribute('aria-pressed', 'true')
  } finally {
    for (const id of ids) await request.delete('/api/transactions/' + id)
  }
})
