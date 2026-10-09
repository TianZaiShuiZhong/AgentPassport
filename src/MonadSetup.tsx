import { useEffect, useState } from 'react';
import { Copy, Check, ExternalLink, LoaderCircle, Network, RefreshCw, Rocket } from 'lucide-react';
import { request } from './api';
type Status = {
  chainId: number;
  relayAddress: string;
  balance: string;
  funded: boolean;
  active: boolean;
  deployment: { address: string; transactionHash: string } | null;
};
export default function MonadSetup({ onError }: { onError: (text: string) => void }) {
  const [status, setStatus] = useState<Status | null>(null),
    [busy, setBusy] = useState(''),
    [copied, setCopied] = useState(false);
  async function load() {
    setBusy('load');
    try {
      setStatus(await request('vault', '/monad/status'));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function deploy() {
    setBusy('deploy');
    try {
      await request('vault', '/monad/deploy', {}, true);
      await load();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function activate() {
    setBusy('activate');
    try {
      await request('vault', '/monad/activate', {}, true);
      setTimeout(() => location.assign(location.pathname), 12000);
    } catch (e) {
      onError((e as Error).message);
      setBusy('');
    }
  }
  return (
    <div className="monad-setup">
      <div className="setup-title">
        <Network size={20} />
        <h3>Monad 测试网向导</h3>
        <button
          className="icon-button"
          aria-label="检查测试网余额"
          onClick={() => void load()}
          disabled={Boolean(busy)}
        >
          <RefreshCw size={15} />
        </button>
      </div>
      <p>
        使用本机托管的专用测试钱包部署和支付中继 gas。它与用户自己的钱包分开，私钥保存在本地 .data
        中。
      </p>
      <div className="setup-step">
        <span>01</span>
        <div>
          <strong>为本机测试钱包领取测试 MON</strong>
          <p>复制下面的地址，在水龙头中领取测试币。只需测试币，无需真实资金。</p>
          {status ? (
            <div className="setup-address">
              <code>{status.relayAddress}</code>
              <button
                aria-label="复制测试钱包地址"
                onClick={async () => {
                  await navigator.clipboard.writeText(status.relayAddress);
                  setCopied(true);
                }}
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
              </button>
            </div>
          ) : (
            <span className="subtle">{busy ? '正在检查 RPC…' : '点击右上角刷新以重试'}</span>
          )}
          <a
            className="plain-link violet"
            href="https://faucet.monad.xyz"
            target="_blank"
            rel="noreferrer"
          >
            打开官方水龙头 <ExternalLink size={13} />
          </a>
        </div>
      </div>
      <div className="setup-step">
        <span>02</span>
        <div>
          <strong>确认余额并部署合约</strong>
          <p>
            当前余额：{status ? `${Number(status.balance).toFixed(4)} 测试 MON` : '待检查'}
            。部署会消耗测试币 gas。
          </p>
          <button
            className="button"
            onClick={() => void deploy()}
            disabled={!status?.funded || Boolean(status.deployment) || Boolean(busy)}
          >
            {busy === 'deploy' ? <LoaderCircle className="spin" size={15} /> : <Rocket size={15} />}{' '}
            {status?.deployment ? '合约已部署' : '部署测试网合约'}
          </button>
          {status?.deployment && (
            <div className="setup-address">
              <code>{status.deployment.address}</code>
              <a
                href={`https://testnet.monadscan.com/tx/${status.deployment.transactionHash}`}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={15} />
              </a>
            </div>
          )}
        </div>
      </div>
      <div className="setup-step">
        <span>03</span>
        <div>
          <strong>切换项目到测试网</strong>
          <p>本地演示记录会保留。测试网从独立工作空间开始，切换时服务会自动重启。</p>
          <button
            className="button secondary"
            onClick={() => void activate()}
            disabled={!status?.deployment || status.active || Boolean(busy)}
          >
            {busy === 'activate' ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <Network size={15} />
            )}{' '}
            {status?.active
              ? '已在测试网运行'
              : busy === 'activate'
                ? '正在重启，请稍候…'
                : '启用 Monad 测试网'}
          </button>
        </div>
      </div>
    </div>
  );
}
