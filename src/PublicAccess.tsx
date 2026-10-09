import { useEffect, useState, type ReactNode } from 'react';
import { BookOpen, ShieldCheck, ArrowRight, LoaderCircle } from 'lucide-react';
import { publicMode } from './api';
export default function PublicAccess({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!publicMode),
    [checking, setChecking] = useState(publicMode),
    [code, setCode] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (publicMode)
      fetch('/public/session')
        .then((r) => r.json())
        .then((d) => setReady(d.authenticated))
        .catch(() => setError('演示服务暂时不可用'))
        .finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    const lock = () => {
      setReady(false);
      setCode('');
      setError('演示会话已过期，请重新输入访问码');
    };
    window.addEventListener('public-session-expired', lock);
    return () => window.removeEventListener('public-session-expired', lock);
  }, []);
  async function login() {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/public/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setReady(true);
      setCode('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (ready) return children;
  return (
    <div className="public-access-page">
      <div className="public-access-card">
        <span className="logo-mark">
          <BookOpen size={23} />
        </span>
        <span className="eyebrow">AGENTPASSPORT · LIVE DEMO</span>
        <h1>
          让记忆流动，
          <br />
          让信任有据。
        </h1>
        <p>在 Monad 测试网上体验用户可控的 AI 记忆、授权与可验证履历。</p>
        <div className="public-live-badge">
          <ShieldCheck size={16} /> Monad Testnet · DeepSeek
        </div>
        {checking ? (
          <div className="loading">
            <LoaderCircle size={18} className="spin" />
            检查演示会话…
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void login();
            }}
          >
            <label htmlFor="demo-code">演示访问码</label>
            <input
              id="demo-code"
              type="password"
              autoComplete="off"
              className="form-input"
              placeholder="输入项目作者分享的访问码"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            {error && (
              <p className="public-login-error" role="alert">
                {error}
              </p>
            )}
            <button className="button" type="submit" disabled={busy || !code.trim()}>
              {busy ? <LoaderCircle size={16} className="spin" /> : <ArrowRight size={16} />}
              进入演示
            </button>
          </form>
        )}
        <small>无需提交私钥。用户钱包操作会另行请求签名确认。</small>
      </div>
    </div>
  );
}
