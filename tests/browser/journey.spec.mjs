import { test, expect } from '@playwright/test';
test('owner grants memories, independent writer uses them, verifies output, then revokes', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByText('协议运行中')).toBeVisible();
  await page.screenshot({ path: 'test-results/overview-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '创建授权', exact: true }).click();
  await page.getByRole('button', { name: '签发链上授权' }).click();
  await expect(page.getByText('授权已写入链上，应用现在可以按范围读取')).toBeVisible();
  await page.getByRole('button', { name: 'Writing Studio', exact: true }).click();
  await page.getByRole('button', { name: '测试私密记忆访问' }).click();
  await expect(page.getByText(/私密内容未返回给应用/)).toBeVisible();
  await page.getByRole('button', { name: '读取记忆并生成' }).click();
  await expect(page.getByText('文章已生成，输入与输出凭证已锚定到链上')).toBeVisible();
  await expect(page.getByText('内容长度', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/writer-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '查看凭证' }).click();
  await page.getByRole('button', { name: '从链上核验' }).click();
  await expect(page.getByText('凭证验证通过')).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '授权管理', exact: true }).click();
  await page.getByRole('button', { name: '撤销全部有效授权' }).click();
  await expect(page.getByText('授权已撤销，后续读取将被拒绝')).toBeVisible();
  await page.getByRole('button', { name: 'Writing Studio', exact: true }).click();
  await page.getByRole('button', { name: '读取记忆并生成' }).click();
  await expect(page.getByRole('status')).toContainText('授权已撤销');
  expect(errors).toEqual([]);
});
test('research can save memory and owner can inspect actual encryption', async ({ page }) => {
  const title = `浏览器测试 · 用户需求 ${Date.now()}`;
  await page.goto('/');
  await page.getByRole('button', { name: 'Research Studio', exact: true }).click();
  await page.getByLabel('记忆名称').fill(title);
  await page.getByLabel('记忆正文').fill('用户需要自主决定哪些上下文能在不同应用之间迁移。');
  await page.getByRole('button', { name: '加密并保存' }).click();
  await expect(page.getByText('记忆已加密保存，密文哈希已提交到链上')).toBeVisible();
  await page.getByRole('button', { name: '记忆保险箱', exact: true }).click();
  await page
    .getByRole('article')
    .filter({ hasText: title })
    .getByRole('button', { name: '查看记忆' })
    .click();
  await expect(page.getByText('所有者解密视图')).toBeVisible();
  await expect(
    page.getByText('用户需要自主决定哪些上下文能在不同应用之间迁移。', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('实际存储的密文封装')).toBeVisible();
});
test('mobile overview has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByText('协议运行中')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/overview-mobile.png', fullPage: true });
});
test('independent writer window runs its own UI and reads metadata through its process', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:8879');
  await expect(page.getByRole('heading', { name: '接着你的记忆，开始下一篇。' })).toBeVisible();
  await expect(page.getByRole('button', { name: '读取记忆并生成' })).toBeVisible();
  await expect(page.getByRole('button', { name: '授权管理', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '可信履历', exact: true }).click();
  await expect(page.getByRole('button', { name: '核验', exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: '核验', exact: true }).first().click();
  await page.getByRole('button', { name: '从链上核验' }).click();
  await expect(page.getByText('凭证验证通过')).toBeVisible();
  expect(errors).toEqual([]);
});
