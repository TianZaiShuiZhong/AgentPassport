import { test, expect } from '@playwright/test';
import { Wallet, getBytes } from 'ethers';

test('wallet signs login, owns Agent, grants access and revokes with explicit typed signatures', async ({
  page,
}) => {
  const wallet = Wallet.createRandom(),
    methods = [];
  await page.exposeFunction('testWalletRequest', async ({ method, params }) => {
    methods.push(method);
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [wallet.address];
    if (method === 'eth_chainId') return '0x539';
    if (method === 'personal_sign') return wallet.signMessage(getBytes(params[0]));
    if (method === 'eth_signTypedData_v4') {
      const data = JSON.parse(params[1]),
        types = { ...data.types };
      delete types.EIP712Domain;
      return wallet.signTypedData(data.domain, types, data.message);
    }
    throw new Error(`Unsupported test wallet method ${method}`);
  });
  await page.addInitScript(() => {
    window.ethereum = {
      request: (args) => window.testWalletRequest(args),
      on: () => {},
      removeListener: () => {},
    };
  });
  await page.goto('/');
  await expect(page.getByText('演示 Agent #1', { exact: true })).toBeVisible();
  let releaseStale;
  let signalStale;
  const staleStarted = new Promise((resolve) => {
    signalStale = resolve;
  });
  const staleGate = new Promise((resolve) => {
    releaseStale = resolve;
  });
  let held = false;
  await page.route('**/api/state', async (route) => {
    if (held) return route.continue();
    held = true;
    const response = await route.fetch();
    signalStale();
    await staleGate;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: '刷新状态' }).click();
  await staleStarted;
  await page.getByRole('button', { name: '连接钱包', exact: true }).click();
  await page.getByRole('button', { name: '连接并签名登录' }).click();
  await expect(page.getByText('钱包登录成功；尚未签发任何记忆授权')).toBeVisible();
  await page.getByRole('button', { name: '签名注册我的 Agent' }).click();
  await expect(page.getByText(/新的 Agent 已注册/)).toBeVisible();
  await expect(page.getByText(/钱包实际所有/)).toBeVisible();
  const oldStateResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/state' && !new URL(response.url()).search,
  );
  releaseStale();
  await (await oldStateResponse).finished();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await expect(page.getByText('我的钱包工作空间')).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: 'Research Studio', exact: true }).click();
  await expect(page.locator('.muted-count')).toHaveText('0');
  const workspaceUrl = page.url();
  expect(workspaceUrl).toMatch(/agentId=\d+/);
  await page.reload();
  await expect(page.getByText('我的钱包工作空间')).toBeVisible();
  await expect(page.locator('.passport-bottom')).toContainText(wallet.address.slice(0, 8));
  expect(page.url()).toBe(workspaceUrl);
  await page.getByRole('button', { name: 'Research Studio', exact: true }).click();
  await page.getByLabel('记忆名称').fill('钱包签名测试 · 项目背景');
  await page
    .getByLabel('记忆正文')
    .fill('AgentPassport 将用户授权的研究背景带到写作应用。钱包拥有 Agent，用户可以撤销后续访问。');
  await page.getByRole('button', { name: '加密并保存' }).click();
  await expect(page.getByText('记忆已加密保存，密文哈希已提交到链上')).toBeVisible();
  await page.getByRole('button', { name: '授权管理', exact: true }).click();
  await page
    .locator('.page-heading')
    .getByRole('button', { name: '创建授权', exact: true })
    .click();
  await page.getByRole('dialog').getByRole('checkbox', { name: /钱包签名测试/ }).check();
  await page.getByRole('button', { name: '签发链上授权' }).click();
  await expect(page.getByText('授权已写入链上，应用现在可以按范围读取')).toBeVisible();
  await page.getByRole('button', { name: 'Writing Studio', exact: true }).click();
  const writeRequest = page.waitForRequest((request) => request.url().includes('/writer-api/run'));
  await page.getByRole('button', { name: '读取记忆并生成' }).click();
  expect((await writeRequest).postDataJSON().memoryIds).toHaveLength(1);
  await expect(page.getByText('文章已生成，输入与输出凭证已锚定到链上')).toBeVisible();
  await page.getByRole('button', { name: '授权管理', exact: true }).click();
  await page.getByRole('button', { name: '撤销全部有效授权' }).click();
  await expect(page.getByText('授权已撤销，后续读取将被拒绝')).toBeVisible();
  expect(methods.filter((m) => m === 'personal_sign')).toHaveLength(1);
  expect(methods.filter((m) => m === 'eth_signTypedData_v4')).toHaveLength(3);
  // An expired login keeps the chosen Agent and permits fresh login without
  // attaching its protected workspace to the public challenge/login request.
  await page.evaluate(() => sessionStorage.removeItem('agentpassport-wallet-session'));
  await page.route('**/api/config?agentId=*', async (route) => {
    if (route.request().headers()['x-wallet-token']) return route.continue();
    await route.fulfill({
      status: 401,
      json: {
        code: 'WALLET_SESSION_REQUIRED',
        error: '钱包会话已过期，请重新连接并登录',
      },
    });
  });
  await page.reload();
  expect(page.url()).toBe(workspaceUrl);
  await expect(page.locator('.error-banner')).toContainText('钱包会话已过期');
  await page.getByRole('button', { name: '连接钱包', exact: true }).click();
  const challengeRequest = page.waitForRequest((request) =>
    request.url().includes('/wallet/challenge'),
  );
  await page.getByRole('button', { name: '连接并签名登录' }).click();
  expect((await challengeRequest).url()).not.toContain('agentId=');
  await expect(page.getByText(/钱包实际所有/)).toBeVisible();
  expect(methods.filter((m) => m === 'personal_sign')).toHaveLength(2);
});

test('without a wallet the UI explains how to open an extension-enabled browser', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '连接钱包', exact: true }).click();
  await page.getByRole('button', { name: '连接并签名登录' }).click();
  await expect(page.getByRole('status')).toContainText('未检测到钱包扩展');
});
