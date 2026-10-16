import { test, expect } from './fixtures'
import { mkdir } from 'node:fs/promises'
const screenshotDirectory = '/private/tmp/thuchithue-screenshots'
test('local finance workflow with attachments and persistent reports', async ({
  page,
}) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Thu Chi', exact: true }),
  ).toBeVisible()
  if (
    await page
      .getByRole('button', { name: 'Khám phá với dữ liệu mẫu' })
      .isVisible()
  )
    await page.getByRole('button', { name: 'Khám phá với dữ liệu mẫu' }).click()
  await expect(page.locator('.profit-value')).toContainText('8.300.000')
  await page.getByLabel('NHẬP SỐ TIỀN').fill('+250000')
  await expect(page.locator('#amount')).toHaveValue('+250.000')
  await page.getByLabel('Nội dung', { exact: true }).fill('Browser test income')
  await page.getByRole('button', { name: 'Ghi giao dịch', exact: true }).click()
  await expect(
    page.getByText('Đã ghi giao dịch', { exact: true }),
  ).toBeVisible()
  await expect(page.locator('.profit-value')).toContainText('8.550.000')
  await expect(page.locator('#amount')).toBeFocused()
  await page.reload()
  await expect(page.locator('.profit-value')).toContainText('8.550.000')
  await page.getByRole('button', { name: 'Xem tất cả' }).click()
  await page.getByLabel('Tìm giao dịch').fill('Browser test income')
  await page
    .getByRole('button', { name: 'Mở giao dịch Browser test income' })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Chi tiết giao dịch' })
  await dialog.locator('#edit-amount').fill('+300000')
  await dialog
    .locator('input[type=file]')
    .setInputFiles({
      name: 'proof.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\nBrowser invoice\n%%EOF'),
    })
  await expect(dialog.getByText('proof.pdf')).toBeVisible()
  await dialog.getByRole('button', { name: 'Lưu thay đổi' }).click()
  await page
    .getByRole('dialog', { name: 'Tất cả giao dịch' })
    .getByRole('button', { name: 'Đóng' })
    .click()
  await expect(page.locator('.profit-value')).toContainText('8.600.000')
  await page.getByRole('button', { name: 'Xem tất cả' }).click()
  await page
    .getByRole('button', { name: 'Mở giao dịch Browser test income' })
    .click()
  const download = page.waitForEvent('download')
  await dialog.getByRole('link', { name: 'proof.pdf' }).click()
  expect((await download).suggestedFilename()).toBe('proof.pdf')
  await dialog
    .getByRole('button', { name: 'Xóa giao dịch', exact: true })
    .click()
  await page.getByRole('button', { name: 'Xác nhận xóa' }).click()
  await page
    .getByRole('dialog', { name: 'Tất cả giao dịch' })
    .getByRole('button', { name: 'Đóng' })
    .click()
  await expect(page.locator('.profit-value')).toContainText('8.300.000')
  const backup = page.waitForEvent('download')
  await page
    .getByRole('button', { name: 'Tải bản sao lưu (.db)', exact: true })
    .click()
  expect((await backup).suggestedFilename()).toMatch(
    /^thuchithue__backup_\d{8}_\d{6}\.db$/,
  )
})
test('amount caret, undo, signs and large exact values', async ({
  page,
  context,
}) => {
  await page.goto('/')
  const amount = page.locator('#amount')
  await amount.fill('+12500000')
  await expect(amount).toHaveValue('+12.500.000')
  await amount.evaluate((input: HTMLInputElement) =>
    input.setSelectionRange(4, 4),
  )
  await amount.press('Backspace')
  await expect(amount).toHaveValue('+1.500.000')
  await amount.press('Meta+z')
  await expect(amount).toHaveValue('+12.500.000')
  await amount.press('Meta+Shift+z')
  await expect(amount).toHaveValue('+1.500.000')
  await amount.fill('-750000')
  await expect(
    page.getByText('Khoản chi', { exact: true }).first(),
  ).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Danh mục', exact: true })).toHaveText('Thiết bị')
  await amount.fill('9223372036854775807')
  await expect(amount).toHaveValue('+9.223.372.036.854.775.807')
  await amount.fill('9223372036854775808')
  await expect(
    page.getByText('Số tiền vượt giới hạn VND', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Ghi giao dịch', exact: true }),
  ).toBeDisabled()
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await amount.fill('')
  await page.evaluate(() => navigator.clipboard.writeText('+1,200,000'))
  await amount.press('Meta+v')
  await expect(amount).toHaveValue('+1.200.000')
  await page.evaluate(() => navigator.clipboard.writeText('1,2'))
  await amount.press('Meta+a')
  await amount.press('Meta+v')
  await expect(
    page.getByText('Số tiền không hợp lệ hoặc vượt giới hạn VND'),
  ).toBeVisible()
  await expect(amount).toHaveValue('+1.200.000')
})
test('category management validation and reference protection', async ({
  page,
}) => {
  await page.goto('/')
  await page.locator('#amount').fill('+')
  await page.getByRole('combobox', { name: 'Danh mục', exact: true }).click()
  await page.getByRole('option', { name: '＋ Mới', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Quản lý danh mục' })
  await expect(dialog.getByLabel('Xóa Steam')).toBeDisabled()
  await dialog
    .getByLabel('Tên danh mục', { exact: true })
    .fill('Browser category')
  await dialog.getByRole('button', { name: 'Lưu danh mục' }).click()
  await expect(
    dialog.getByText('Browser category', { exact: true }),
  ).toBeVisible()
  await dialog.getByLabel('Sửa Browser category').click()
  await dialog
    .getByLabel('Tên danh mục', { exact: true })
    .fill('Updated category')
  await dialog.getByRole('button', { name: 'Lưu danh mục' }).click()
  await dialog.getByLabel('Xóa Updated category').click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Xóa danh mục', exact: true })
    .click()
  await expect(
    dialog.getByText('Updated category', { exact: true }),
  ).not.toBeVisible()
  await dialog.getByRole('button', { name: 'Đóng' }).click()
  await expect(
    page.getByRole('combobox', { name: 'Danh mục', exact: true }),
  ).toBeFocused()
})
test('rule draft preview and cancel preserve current version', async ({
  page,
  request,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Quy tắc thuế', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: /Quy tắc thuế năm/ })
  await dialog.getByLabel('Tỷ lệ trên doanh thu (%)').fill('6')
  await dialog.getByLabel('Lý do thay đổi').fill('Browser draft test')
  await dialog.getByRole('button', { name: 'Xem trước', exact: true }).click()
  await expect(dialog.getByText('Ảnh hưởng của quy tắc mới')).toBeVisible()
  await dialog.getByRole('button', { name: 'Áp dụng phiên bản mới' }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Hủy', exact: true })
    .click()
  await dialog.getByRole('button', { name: 'Đóng', exact: true }).click()
  const state = await (await request.get('/api/state')).json()
  const tax = await (
    await request.get('/api/tax/' + state.today.slice(0, 4))
  ).json()
  expect(tax.rule.revenue_bps).toBe(500)
  await page.getByRole('button', { name: 'Năm', exact: true }).click()
  await expect(page.locator('.report-period')).toContainText('Năm')
})
for (const width of [320, 362, 375, 768, 1330, 1440]) {
  test(`responsive layout at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width >= 1100 ? 994 : 900 })
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('/')
    await expect(
      page.getByRole('heading', { name: 'Báo Cáo', exact: true }),
    ).toBeVisible()
    await page.locator('#amount').fill('+12500000')
    const geometry = await page.evaluate(() => {
      const panels = Array.from(document.querySelectorAll('.panel')).map(
        (p) => {
          const b = p.getBoundingClientRect()
          return { x: b.x, y: b.y, width: b.width }
        },
      )
      return {
        panels,
        width: document.documentElement.scrollWidth,
        viewport: innerWidth,
        brokenAmount: Array.from(
          document.querySelectorAll('.metric-card .money'),
        ).some((e) => {
          const range = document.createRange()
          range.selectNodeContents(e.firstChild!)
          return range.getClientRects().length > 1
        }),
        metricOverflow: Array.from(
          document.querySelectorAll('.metric-card'),
        ).some((e) => e.scrollWidth > e.clientWidth),
        animations: Array.from(document.querySelectorAll('*')).some(
          (e) =>
            getComputedStyle(e).animationName !== 'none' ||
            getComputedStyle(e).transitionDuration !== '0s',
        ),
      }
    })
    expect(geometry.width).toBeLessThanOrEqual(width)
    expect(geometry.animations).toBe(false)
    expect(geometry.metricOverflow).toBe(false)
    expect(geometry.brokenAmount).toBe(false)
    if (width >= 1100) expect(geometry.panels[0].y).toBe(geometry.panels[1].y)
    else {
      expect(geometry.panels[0].y).toBeLessThan(geometry.panels[1].y)
      expect(geometry.panels[1].y).toBeLessThan(geometry.panels[2].y)
    }
    await page
      .getByRole('button', { name: 'Đính kèm', exact: false })
      .scrollIntoViewIfNeeded()
    await expect(
      page.getByRole('button', { name: 'Đính kèm', exact: false }),
    ).toBeVisible()
    await mkdir(screenshotDirectory, { recursive: true })
    await page.screenshot({
      path: `${screenshotDirectory}/${width}.png`,
      fullPage: true,
    })
    expect(errors).toEqual([])
  })
}

test('grouped rule thresholds and decimal percentages persist as numeric values', async ({ page, request }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Quy tắc thuế', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: /Quy tắc thuế năm/ })
  await expect(dialog.getByLabel('Ngưỡng miễn thuế (VND)')).toHaveValue('1.000.000.000')
  await dialog.getByLabel('Ngưỡng miễn thuế (VND)').fill('1200000000')
  await expect(dialog.getByLabel('Ngưỡng miễn thuế (VND)')).toHaveValue('1.200.000.000')
  await dialog.getByLabel('Tỷ lệ trên doanh thu (%)').fill('6,5')
  await dialog.getByLabel('Lý do thay đổi').fill('Verify grouped numeric input persistence')
  await dialog.getByRole('button', { name: 'Xem trước', exact: true }).click()
  await expect(dialog.getByText('Ảnh hưởng của quy tắc mới')).toBeVisible()
  await dialog.getByRole('button', { name: 'Áp dụng phiên bản mới' }).click()
  await page.getByRole('button', { name: 'Xác nhận áp dụng' }).click()
  await expect(dialog).not.toBeVisible()
  const state = await (await request.get('/api/state')).json()
  const tax = await (await request.get('/api/tax/' + state.today.slice(0, 4))).json()
  expect(tax.rule.threshold).toBe(1200000000)
  expect(tax.rule.revenue_bps).toBe(650)
  await page.getByRole('button', { name: 'Cài đặt', exact: true }).click()
  await page.getByLabel('Tỷ lệ lợi nhuận của bạn (%)').fill('70,5')
  await page.getByRole('button', { name: 'Lưu cài đặt' }).click()
  await expect(page.getByRole('dialog', { name: 'Cài đặt', exact: true })).not.toBeVisible()
  const saved = await (await request.get('/api/state')).json()
  expect(saved.settings.share_bps).toBe('7050')
})

test('reset settings require the exact password and cancel preserves data', async ({ page, request }) => {
  await page.goto('/')
  const before = await (await request.get('/api/state')).json()
  await page.locator('#amount').fill('+123456')
  await page.getByRole('button', { name: 'Cài đặt', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Cài đặt', exact: true })
  await settings.getByRole('button', { name: 'Xóa toàn bộ dữ liệu', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Xóa toàn bộ dữ liệu?', exact: true })
  await expect(dialog.getByRole('button', { name: 'Xác nhận xóa toàn bộ' })).toBeDisabled()
  await dialog.getByLabel('Mật khẩu xác nhận').fill('incorrect password')
  await dialog.getByRole('button', { name: 'Xác nhận xóa toàn bộ' }).click()
  await expect(dialog.getByText('Mật khẩu xác nhận không đúng')).toBeVisible()
  await dialog.getByRole('button', { name: 'Hủy', exact: true }).click()
  const unchanged = await (await request.get('/api/state')).json()
  expect(unchanged.transactions).toEqual(before.transactions)
  await settings.getByRole('button', { name: 'Xóa toàn bộ dữ liệu', exact: true }).click()
  await expect(dialog.getByLabel('Mật khẩu xác nhận')).toHaveValue('')
  await dialog.getByLabel('Mật khẩu xác nhận').fill('TOILACONCHOCUNCUNGGAUGAU')
  await dialog.getByRole('button', { name: 'Xác nhận xóa toàn bộ' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(settings).not.toBeVisible()
  await expect(page.getByText('Chưa có giao dịch nào', { exact: true })).toBeVisible()
  await expect(page.locator('#amount')).toHaveValue('')
  const after = await (await request.get('/api/state')).json()
  expect(after.transactions).toEqual([])
  expect(after.settings.share_bps).toBe('7000')
  expect(after.settings.demo).toBe('false')
  await page.reload()
  await expect(page.getByText('Chưa có giao dịch nào', { exact: true })).toBeVisible()
})

test('date category note and attachment drafts survive clearing and collapsing the amount', async ({ page, request }) => {
  await page.goto('/')
  const state = await (await request.get('/api/state')).json()
  const date = state.today.slice(0, 8) + '01'
  await expect(page.locator('#amount')).toHaveValue('')
  await expect(page.getByLabel('Nội dung', { exact: true })).toBeHidden()
  await page.locator('#amount').fill('-')
  const category = page.getByRole('combobox', { name: 'Danh mục', exact: true })
  await category.click()
  await page.getByRole('option', { name: state.categories.find((c: { id: number }) => c.id === 2).name, exact: true }).click()
  await expect(category).toHaveText(state.categories.find((c: { id: number }) => c.id === 2).name)
  await page.getByLabel('Ngày giao dịch', { exact: true }).fill(date)
  await page.getByLabel('Nội dung', { exact: true }).fill('Prepared expense')
  await page.locator('.entry-panel input[type=file]').setInputFiles({ name: 'prepared.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nPrepared invoice\n%%EOF') })
  await expect(page.getByText('prepared.pdf', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ghi giao dịch', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Xóa số tiền', exact: true }).click()
  await expect(page.getByLabel('Nội dung', { exact: true })).toBeHidden()
  await page.locator('#amount').fill('-100000')
  await expect(page.getByLabel('Nội dung', { exact: true })).toHaveValue('Prepared expense')
  await expect(page.getByText('prepared.pdf', { exact: true })).toBeVisible()
  await expect(category).toHaveText(state.categories.find((c: { id: number }) => c.id === 2).name)
  await page.getByRole('button', { name: 'Ghi giao dịch', exact: true }).click()
  await expect(page.getByText('Đã ghi giao dịch', { exact: true })).toBeVisible()
  const after = await (await request.get('/api/state')).json()
  const saved = after.transactions.find((t: { note: string }) => t.note === 'Prepared expense')
  expect(saved.amount).toBe('-100000')
  expect(saved.date).toBe(date)
  expect(saved.category_id).toBe(2)
  expect(saved.attachments[0].name).toBe('prepared.pdf')
})

test('recent months scroll all entries and support keyboard navigation safely', async ({ page, request }) => {
  const year = Number((await (await request.get('/api/state')).json()).today.slice(0, 4))
  const created: number[] = []
  for (let i = 0; i < 12; i++) {
    const response = await request.post('/api/transactions', { multipart: { data: JSON.stringify({ amount: '10000', category_id: 1, date: i < 10 ? `${year}-08-15` : `${year}-07-15`, note: `Monthly transaction ${i}`, deductible: false, request_id: 'monthly_' + crypto.randomUUID(), remove: [] }) } })
    expect(response.ok()).toBe(true)
    created.push((await response.json()).id)
  }
  await page.goto('/')
  const history = page.getByRole('region', { name: /^Giao dịch gần đây/ })
  const navigation = page.getByRole('navigation', { name: 'Chọn tháng giao dịch gần đây' })
  const august = navigation.getByRole('button', { name: `Tháng 8 năm ${year}`, exact: true })
  const july = navigation.getByRole('button', { name: `Tháng 7 năm ${year}`, exact: true })
  await august.click()
  const beforeGeometry = await page.locator('.workspace > .panel').evaluateAll(elements => elements.map(e => e.getBoundingClientRect().height))
  await expect(history.getByRole('heading')).toHaveText(`Giao dịch gần đây • Tháng 8/${year}`)
  await expect(history.locator('.transaction-row')).toHaveCount(10)
  const list = history.locator('.recent-transactions')
  expect(await list.evaluate(e => e.scrollHeight > e.clientHeight)).toBe(true)
  await list.evaluate(e => { e.scrollTop = e.scrollHeight })
  await page.locator('#amount').fill('+1234')
  await page.locator('#amount').press('ArrowRight')
  await expect(august).toHaveAttribute('aria-current', 'page')
  const beforePaging = await navigation.boundingBox()
  const beforeHistory = await history.boundingBox()
  await history.focus()
  await page.keyboard.press('ArrowRight')
  await expect(july).toHaveAttribute('aria-current', 'page')
  await expect(history.locator('.transaction-row')).toHaveCount(2)
  expect(await page.locator('.workspace > .panel').evaluateAll(elements => elements.map(e => e.getBoundingClientRect().height))).toEqual(beforeGeometry)
  expect((await navigation.boundingBox())!.y - (await history.boundingBox())!.y).toBe(beforePaging!.y - beforeHistory!.y)
  expect(await list.evaluate(e => e.scrollTop)).toBe(0)
  await history.locator('.transaction-row').first().click()
  const dialog = page.getByRole('dialog', { name: 'Chi tiết giao dịch' })
  await dialog.getByRole('button', { name: 'Đóng', exact: true }).focus()
  await page.keyboard.press('ArrowLeft')
  await dialog.getByRole('button', { name: 'Đóng', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(july).toHaveAttribute('aria-current', 'page')
  await history.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(august).toHaveAttribute('aria-current', 'page')
  await page.reload()
  await expect(history.getByRole('heading')).toHaveText(`Giao dịch gần đây • Tháng ${Number(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date()).slice(5, 7))}/${year}`)
  for (const id of created) expect((await request.delete('/api/transactions/' + id)).ok()).toBe(true)
})

test('USD input uses the manual rate and preserves original currency across edits and reload', async ({ page, request }) => {
  await page.goto('/')
  await expect(page.getByLabel('Tỷ giá USD', { exact: true })).toHaveValue('25.850')
  const rate = page.getByLabel('Tỷ giá USD', { exact: true })
  await page.locator('#amount').fill('+')
  await rate.fill('25000')
  await rate.blur()
  await expect(rate).toHaveValue('25.000')
  await page.locator('#amount').fill('$100.50')
  await page.locator('#amount').focus()
  await page.getByLabel('Nội dung', { exact: true }).fill('USD income')
  await expect(page.locator('#amount')).toHaveValue('+2.512.500')
  await page.getByRole('button', { name: 'Ghi giao dịch', exact: true }).click()
  await expect(page.getByText('Đã ghi giao dịch', { exact: true })).toBeVisible()
  const row = page.getByRole('button', { name: 'Mở giao dịch USD income', exact: true })
  await expect(row.locator('.transaction-usd')).toHaveText('$100,50')
  await expect(row.locator('.transaction-amount')).toContainText('2.512.500')
  await expect(page.locator('.report-usd')).toHaveCount(3)
  let state = await (await request.get('/api/state')).json()
  let saved = state.transactions.find((t: { note: string }) => t.note === 'USD income')
  expect(saved.amount).toBe('2512500')
  expect(saved.usd_minor).toBe('10050')
  expect(saved.exchange_rate).toBe('25000')
  await page.locator('#amount').fill('+')
  await rate.fill('26000')
  await rate.blur()
  await page.reload()
  await expect(page.getByLabel('Tỷ giá USD', { exact: true })).toHaveValue('26.000')
  await expect(row.locator('.transaction-usd')).toHaveText('$100,50')
  await expect(row.locator('.transaction-amount')).toContainText('2.512.500')
  await row.click()
  const dialog = page.getByRole('dialog', { name: 'Chi tiết giao dịch' })
  await expect(dialog.getByLabel('Tỷ giá USD', { exact: true })).toHaveValue('25.000')
  await dialog.getByLabel('Nội dung', { exact: true }).fill('USD income edited')
  await dialog.getByRole('button', { name: 'Lưu thay đổi' }).click()
  await expect(dialog).not.toBeVisible()
  state = await (await request.get('/api/state')).json()
  saved = state.transactions.find((t: { note: string }) => t.note === 'USD income edited')
  expect(saved.amount).toBe('2512500')
  expect(saved.usd_minor).toBe('10050')
  expect(saved.exchange_rate).toBe('25000')
  await page.locator('#amount').fill('-$12.34')
  await page.getByLabel('Nội dung', { exact: true }).fill('USD expense')
  await expect(page.locator('#amount')).toHaveValue('-320.840')
  await page.getByRole('button', { name: 'Ghi giao dịch', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Mở giao dịch USD expense', exact: true }).locator('.transaction-usd')).toHaveText('-$12,34')
  state = await (await request.get('/api/state')).json()
  saved = state.transactions.find((t: { note: string }) => t.note === 'USD expense')
  expect(saved.amount).toBe('-320840')
  expect(saved.usd_minor).toBe('-1234')
  expect(saved.exchange_rate).toBe('26000')
  for (const width of [320, 362, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const geometry = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth, overflow: Array.from(document.querySelectorAll('.metric-card')).some(e => e.scrollWidth > e.clientWidth), colors: Array.from(document.querySelectorAll('.report-amount')).map(e => ({ vnd: getComputedStyle(e.querySelector('.money')!).color, usd: getComputedStyle(e.querySelector('.report-usd')!).color, opacity: Number(getComputedStyle(e.querySelector('.report-usd')!).opacity) })) }))
    expect(geometry.width).toBeLessThanOrEqual(geometry.viewport)
    expect(geometry.overflow).toBe(false)
    for (const color of geometry.colors) { expect(color.usd).toBe(color.vnd); expect(color.opacity).toBeLessThan(1); expect(color.opacity).toBeGreaterThanOrEqual(0.5) }
    await page.screenshot({ path: `${screenshotDirectory}/usd-${width}.png`, fullPage: true })
  }
})
