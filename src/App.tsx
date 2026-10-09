import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ArrowUpRight,
  ArrowRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileCheck2,
  Fingerprint,
  Globe2,
  KeyRound,
  Layers3,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  MoreHorizontal,
  Network,
  Plus,
  Search,
  Send,
  Settings2,
  Shield,
  ShieldCheck,
  Sparkles,
  SquarePen,
  Terminal,
  Timer,
  Trash2,
  X,
  CircleAlert,
  RefreshCw,
} from 'lucide-react';
import {
  request,
  standalone,
  short,
  date,
  KIND,
  ApiError,
  getWalletSession,
  expireWalletSession,
  selectedWorkspace,
  type Config,
  type State,
  type Memory,
  type Grant,
  type Receipt,
  type Task,
  type Kind,
} from './api';
import { injected, loginWallet, walletOperation, forgetWallet } from './wallet';
import MonadSetup from './MonadSetup';

type Page =
  | 'overview'
  | 'memories'
  | 'permissions'
  | 'apps'
  | 'receipts'
  | 'developers'
  | 'research'
  | 'writer';
const NAV: { id: Page; label: string; icon: typeof Shield }[] = [
  { id: 'overview', label: '总览', icon: LayoutDashboard },
  { id: 'memories', label: '记忆保险箱', icon: Database },
  { id: 'permissions', label: '授权管理', icon: KeyRound },
  { id: 'apps', label: '应用工作台', icon: Layers3 },
  { id: 'receipts', label: '可信履历', icon: FileCheck2 },
  { id: 'developers', label: '开发者', icon: Code2 },
];
const EMPTY: State = {
  memories: [],
  grants: [],
  receipts: [],
  audit: [],
  blockNumber: 0,
  chainTime: 0,
  receiptCount: 0,
};
function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={`logo-mark ${small ? 'small' : ''}`}>
      <BookOpen size={small ? 18 : 22} strokeWidth={1.7} />
    </span>
  );
}
function Button({
  children,
  onClick,
  variant = '',
  disabled = false,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button className={`button ${variant} ${className}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
function Badge({ children, color = '' }: { children: ReactNode; color?: string }) {
  return <span className={`badge ${color}`}>{children}</span>;
}
function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [close]);
  return (
    <div className="modal-backdrop" onClick={close}>
      <section
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <div>
            <span className="eyebrow">AGENTPASSPORT</span>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" onClick={close} aria-label="关闭">
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function Passport({ config }: { config: Config | null }) {
  return (
    <div className="passport-wrap">
      <div className="passport-card">
        <div className="passport-top">
          <span>
            <Logo small /> AGENT PASSPORT
          </span>
          <span className="passport-chip">
            <Fingerprint size={22} />
          </span>
        </div>
        <div className="passport-body">
          <div>
            <span className="passport-eyebrow">AUTONOMOUS AGENT</span>
            <h2>
              Atlas<span>↗</span>
            </h2>
            <p>Research. Remember. Create.</p>
          </div>
          <svg className="passport-globe" viewBox="0 0 130 130" aria-hidden="true">
            <circle cx="65" cy="65" r="57" />
            <ellipse cx="65" cy="65" rx="27" ry="57" />
            <ellipse cx="65" cy="65" rx="47" ry="57" />
            <ellipse cx="65" cy="65" rx="57" ry="21" />
            <ellipse cx="65" cy="65" rx="57" ry="42" />
            <path d="M8 65h114M65 8v114" />
          </svg>
        </div>
        <div className="passport-bottom">
          <div>
            <span>AGENT ID</span>
            <strong>#{String(config?.agentId || 1).padStart(4, '0')}</strong>
          </div>
          <div>
            <span>OWNER</span>
            <strong>{short(config?.owner)}</strong>
          </div>
          <div className="passport-stamp">
            <ShieldCheck size={15} /> {config ? 'REGISTERED' : 'CONNECTING'}
          </div>
        </div>
      </div>
      <div className="passport-shadow" />
      <span className="passport-caption">
        <span className="dot purple" /> One identity. Your memory. Every app.
      </span>
    </div>
  );
}
function Spinner() {
  return <LoaderCircle size={16} className="spin" />;
}

export default function App() {
  const [page, setPage] = useState<Page>(standalone || 'overview');
  const [config, setConfig] = useState<Config | null>(null);
  const [state, setState] = useState<State>(EMPTY);
  const [loadError, setLoadError] = useState('');
  const [toast, setToast] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState('');
  const [modal, setModal] = useState<'grant' | 'network' | 'memory' | 'receipt' | 'wallet' | null>(
    null,
  );
  const [connectedWallet, setConnectedWallet] = useState(getWalletSession()?.address || '');
  const [allowResearch, setAllowResearch] = useState(true);
  const [selectedMemory, setSelectedMemory] = useState<Memory | null>(null);
  const [memoryDetail, setMemoryDetail] = useState<{
    memory: { content: string };
    envelope: object;
  } | null>(null);
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const [verification, setVerification] = useState<{
    valid: boolean;
    checks: Record<string, boolean>;
    signer: string;
  } | null>(null);
  const [search, setSearch] = useState('');
  const [grantApp, setGrantApp] = useState('writer');
  const [grantMemories, setGrantMemories] = useState<string[]>([]);
  const [duration, setDuration] = useState(10);
  const [uses, setUses] = useState(5);
  const [researchKind, setResearchKind] = useState<Kind>('background');
  const [researchTitle, setResearchTitle] = useState('');
  const [researchContent, setResearchContent] = useState('');
  const [prompt, setPrompt] = useState('写一篇介绍 AgentPassport 的中文项目文章');
  const [writeMemories, setWriteMemories] = useState<string[]>([]);
  const [task, setTask] = useState<Task | null>(null);
  const [probe, setProbe] = useState<{ allowed: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState('');

  const notify = useCallback((text: string, bad = false) => setToast({ text, bad }), []);
  const reload = useCallback(async () => {
    const workspace = selectedWorkspace();
    try {
      const cfg = await request<Config>(standalone || 'vault', '/config');
      if (selectedWorkspace() !== workspace) return;
      // Independent app pages receive metadata through their own process.
      const data = await request<State>(standalone || 'vault', '/state');
      if (selectedWorkspace() !== workspace) return;
      setConfig((previous) => (JSON.stringify(previous) === JSON.stringify(cfg) ? previous : cfg));
      setState(data);
      setLoadError('');
      setWriteMemories((prev) => {
        const visible = new Set(data.memories.map((m) => m.id));
        const retained = prev.filter((id) => visible.has(id));
        return retained.length
          ? retained
          : data.memories
              .filter((m) => m.kind !== 'private')
              .slice(0, 2)
              .map((m) => m.id);
      });
    } catch (e) {
      if (selectedWorkspace() === workspace) setLoadError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    const provider = injected();
    const expired = () => {
      setConnectedWallet('');
      setConfig(null);
      setState(EMPTY);
      setWriteMemories([]);
      setTask(null);
    };
    const reset = () => {
      forgetWallet(false);
      setConnectedWallet('');
      setWriteMemories([]);
      setTask(null);
      void reload();
    };
    provider?.on?.('accountsChanged', reset);
    window.addEventListener('wallet-session-expired', expired);
    const session = getWalletSession();
    if (session)
      void provider
        ?.request({ method: 'eth_accounts' })
        .then((accounts: string[]) => {
          if (!accounts.some((address) => address.toLowerCase() === session.address.toLowerCase()))
            expireWalletSession();
        })
        .catch(() => expireWalletSession());
    return () => {
      provider?.removeListener?.('accountsChanged', reset);
      window.removeEventListener('wallet-session-expired', expired);
    };
  }, [reload]);
  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), 6000);
    return () => clearInterval(timer);
  }, [reload]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const workspace = selectedWorkspace();
    if (page === 'writer')
      request<{ tasks: Task[] }>('writer', '/tasks')
        .then((d) => {
          if (selectedWorkspace() === workspace) setTask(d.tasks[0] || null);
        })
        .catch(() => {});
  }, [page]);
  const active = state.grants.filter((g) => g.status === 'active');
  const allowedMemories = new Set(
    active.filter((g) => g.appId === 'writer').map((g) => g.memoryId),
  );
  const navigate = (next: Page) => {
    setPage(next);
    setSearch('');
  };
  const act = async (name: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(name);
    try {
      await action();
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy('');
      await reload();
    }
  };
  const copy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(''), 1800);
    } catch {
      notify('复制失败，请手动选择文本', true);
    }
  };
  const download = (value: unknown, filename: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
    );
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const openGrant = () => {
    setGrantMemories(
      state.memories
        .filter((m) => m.kind !== 'private')
        .slice(0, 2)
        .map((m) => m.id),
    );
    setModal('grant');
  };
  const createGrant = () =>
    void act('grant', async () => {
      const input = { appId: grantApp, memoryIds: grantMemories, durationMinutes: duration, uses };
      if (config?.controlMode === 'wallet') await walletOperation(config, 'grant', input);
      else await request('vault', '/grants', input, true);
      setModal(null);
      notify('授权已写入链上，应用现在可以按范围读取');
    });
  const revoke = (grants: Grant[]) =>
    void act('revoke', async () => {
      const input = { grantIds: grants.map((g) => g.id) };
      if (config?.controlMode === 'wallet') await walletOperation(config, 'revoke', input);
      else await request('vault', '/grants/revoke', input, true);
      notify('授权已撤销，后续读取将被拒绝');
    });
  const openMemory = (m: Memory) => {
    setSelectedMemory(m);
    setMemoryDetail(null);
    setModal('memory');
    void act('memory', async () => {
      setMemoryDetail(await request('vault', `/memories/${m.id}`, undefined, true));
    });
  };
  const inspectReceipt = (receipt: Receipt) => {
    setSelectedReceipt(receipt);
    setVerification(null);
    setModal('receipt');
  };
  const verify = () =>
    void act('verify', async () => {
      const data = await request<{
        valid: boolean;
        checks: Record<string, boolean>;
        signer: string;
      }>(standalone || 'vault', '/verify', { receiptId: selectedReceipt!.id });
      setVerification(data);
    });
  const runWriter = () =>
    void act('write', async () => {
      if (!config || config.agentId !== (selectedWorkspace() || config.agentId))
        throw new Error('工作空间正在切换，请等待当前 Agent 加载完成');
      const memoryIds = writeMemories.filter((id) => state.memories.some((m) => m.id === id));
      if (!memoryIds.length) throw new Error('请选择当前 Agent 的记忆');
      const result = await request<{ task: Task }>(
        'writer',
        '/run',
        { agentId: config.agentId, prompt, memoryIds },
        true,
      );
      setTask(result.task);
      notify('文章已生成，输入与输出凭证已锚定到链上');
    });
  const probePrivate = () =>
    void act('probe', async () => {
      const m = state.memories.find((m) => m.kind === 'private');
      if (!m) return;
      try {
        await request('writer', '/probe', { memoryId: m.id }, true);
        setProbe({ allowed: true, text: '读取获准：该私密记忆已有明确授权。测试界面不回显正文。' });
      } catch (e) {
        if (
          e instanceof ApiError &&
          ['NO_GRANT', 'REVOKED', 'EXPIRED', 'EXHAUSTED'].includes(e.code)
        )
          setProbe({ allowed: false, text: `${e.code} · ${e.message}。私密内容未返回给应用。` });
        else throw e;
      }
    });
  const saveResearch = () =>
    void act('save', async () => {
      await request(
        'research',
        '/save',
        { kind: researchKind, title: researchTitle, content: researchContent },
        true,
      );
      setResearchTitle('');
      setResearchContent('');
      notify('记忆已加密保存，密文哈希已提交到链上');
    });
  const txLink = (hash: string) =>
    config?.explorer ? (
      <a
        href={`${config.explorer}/tx/${hash}`}
        target="_blank"
        rel="noreferrer"
        className="text-link"
      >
        {short(hash)} <ArrowUpRight size={12} />
      </a>
    ) : (
      <button className="hash-button" onClick={() => void copy(hash, hash)} title={hash}>
        {short(hash)} {copied === hash ? <Check size={12} /> : <Copy size={12} />}
      </button>
    );
  const pageName =
    NAV.find((n) => n.id === page)?.label || (page === 'research' ? '研究助手' : '写作助手');
  const displayedMemories = state.memories.filter((m) =>
    m.title.toLowerCase().includes(search.toLowerCase()),
  );
  const displayedReceipts = state.receipts.filter(
    (r) =>
      r.title.toLowerCase().includes(search.toLowerCase()) ||
      r.txHash.toLowerCase().includes(search.toLowerCase()),
  );
  const sdkExample = `import { AgentPassportClient } from './sdk/index.mjs';\n\nconst passport = new AgentPassportClient({\n  vaultUrl: '${config?.vaultUrl || 'http://127.0.0.1:4391'}',\n  rpcUrl: '${config?.rpcUrl || 'http://127.0.0.1:4391/rpc'}',\n  contractAddress: '${config?.contractAddress || '0x...'}',\n  chainId: ${config?.chainId || 1337},\n  privateKey: process.env.APP_PRIVATE_KEY,\n});\n\n// 独立验签 + 链上检查，然后按授权读取\nconst { memory, receipt, proof } =\n  await passport.readMemory(grantId);\n\nconsole.log(memory.content, proof.valid);`;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate(standalone || 'overview');
          }}
        >
          <Logo />
          <span>
            AgentPassport<small>TRUST THAT TRAVELS</small>
          </span>
        </a>
        <button className="workspace-switch" onClick={() => navigate(standalone || 'overview')}>
          <span className="avatar tiny">A</span>
          <span>
            Atlas Workspace<small>个人工作空间</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <span className="nav-label">WORKSPACE</span>
        <nav>
          {(standalone ? NAV.filter((n) => ['receipts', 'developers'].includes(n.id)) : NAV).map(
            ({ id, label, icon: Icon }) => (
              <button
                key={id}
                aria-label={label}
                className={`nav-item ${page === id ? 'active' : ''}`}
                onClick={() => navigate(id)}
              >
                <Icon size={18} strokeWidth={1.7} />
                <span>{label}</span>
                {id === 'memories' && (
                  <span className="nav-count" aria-hidden="true">
                    {state.memories.length}
                  </span>
                )}
              </button>
            ),
          )}
        </nav>
        <span className="nav-label second">CONNECTED APPS</span>
        <nav>
          {(['research', 'writer'] as const)
            .filter((role) => !standalone || standalone === role)
            .map((role) => (
              <button
                key={role}
                className={`nav-item ${page === role ? 'active' : ''}`}
                onClick={() => navigate(role)}
              >
                {role === 'research' ? (
                  <span className="app-dot blue" />
                ) : (
                  <span className="app-dot purple" />
                )}
                <span>{role === 'research' ? 'Research Studio' : 'Writing Studio'}</span>
                <ArrowUpRight size={13} className="nav-arrow" />
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="track-card">
            <div>
              <Network size={17} />
              <span>BUILT FOR MONAD</span>
            </div>
            <p>Metropolis Hackathon</p>
            <small>Track 04 · Trust, Identity & AI</small>
            <a href="https://hackathon.monad.xyz/" target="_blank" rel="noreferrer">
              查看比赛 <ArrowUpRight size={13} />
            </a>
          </div>
          <button className="profile" onClick={() => setModal('network')}>
            <span className="avatar">Z</span>
            <span>
              {config?.controlMode === 'wallet' ? '我的钱包工作空间' : '演示工作空间'}
              <small>Agent #{config?.agentId || '…'}</small>
            </span>
            <Settings2 size={16} />
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>工作空间</span>
            <ChevronRight size={13} />
            <strong>{pageName}</strong>
          </div>
          <div className="top-actions">
            {config && (
              <Badge color={config.controlMode === 'wallet' ? 'green' : ''}>
                {config.controlMode === 'wallet' ? '我的 Agent' : '演示 Agent'} #{config.agentId}
              </Badge>
            )}
            {(!standalone || config?.publicMode) && (
              <Button variant="secondary" onClick={() => setModal('wallet')}>
                <Fingerprint size={15} />
                {connectedWallet ? short(connectedWallet) : '连接钱包'}
              </Button>
            )}
            <span className="network-pill">
              <span className={`dot ${config ? 'green' : ''}`} />
              {config?.mode === 'monad' ? 'Monad Testnet' : 'Local EVM'}
              <span className="network-chain">{config?.chainId || '…'}</span>
            </span>
            <button
              className="icon-button refresh"
              aria-label="刷新状态"
              onClick={() => void reload()}
            >
              <RefreshCw size={16} />
            </button>
            <Button variant="secondary" onClick={() => setModal('network')}>
              <Globe2 size={15} /> 网络与部署
            </Button>
          </div>
        </header>
        <div className="content">
          {loadError && (
            <div className="error-banner">
              <CircleAlert size={18} />
              <span>{loadError}</span>
              <button onClick={() => void reload()}>重试</button>
            </div>
          )}
          {page === 'overview' && (
            <>
              <section className="hero">
                <div className="hero-copy">
                  <div className="eyebrow">
                    <span className="line" /> YOUR AI, WITHOUT BORDERS
                  </div>
                  <h1>
                    让记忆流动，
                    <br />
                    让信任<span className="violet">有据。</span>
                    <span className="hero-spark">✳</span>
                  </h1>
                  <p>
                    一个身份，连接你的 AI 应用。
                    <br />
                    带走需要的记忆，把访问权留在自己手里。
                  </p>
                  <div className="hero-actions">
                    <Button onClick={openGrant} disabled={!config}>
                      <Plus size={17} /> 创建授权
                    </Button>
                    <button className="plain-link" onClick={() => navigate('apps')}>
                      体验跨应用协作 <ArrowRight size={16} />
                    </button>
                  </div>
                </div>
                <Passport config={config} />
              </section>
              <section className="stats-grid">
                {[
                  {
                    label: '已注册 Agent',
                    value: config ? '01' : '—',
                    icon: Fingerprint,
                    desc: 'Atlas · 身份已注册',
                    color: 'purple',
                  },
                  {
                    label: '加密记忆',
                    value: String(state.memories.length).padStart(2, '0'),
                    icon: Database,
                    desc: '正文链下加密 · 哈希链上',
                    color: 'blue',
                  },
                  {
                    label: '有效授权',
                    value: String(active.length).padStart(2, '0'),
                    icon: KeyRound,
                    desc: '按应用与记忆独立授权',
                    color: 'green',
                  },
                  {
                    label: '链上凭证',
                    value: String(state.receipts.length).padStart(2, '0'),
                    icon: FileCheck2,
                    desc: '签名与交易均可核验',
                    color: 'orange',
                  },
                ].map((s) => (
                  <div className="stat-card" key={s.label}>
                    <div className="stat-label">
                      {s.label}
                      <span className={`soft-icon ${s.color}`}>
                        <s.icon size={17} />
                      </span>
                    </div>
                    <strong>{s.value}</strong>
                    <small>{s.desc}</small>
                  </div>
                ))}
              </section>
              <section className="panel flow-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">HOW IT CONNECTS</span>
                    <h2>记忆跨越应用，权限始终随行</h2>
                  </div>
                  <Badge color="green">
                    <span className="dot green" /> {config ? '协议运行中' : '连接中'}
                  </Badge>
                </div>
                <div className="flow">
                  <button className="flow-node app-node" onClick={() => navigate('research')}>
                    <div className="app-icon blue">
                      <Search size={25} />
                    </div>
                    <strong>Research Studio</strong>
                    <span>研究、整理、保存记忆</span>
                    <small>APPLICATION 01</small>
                  </button>
                  <div className="flow-arrow">
                    <span>加密存储</span>
                    <div />
                    <LockKeyhole size={14} />
                  </div>
                  <button
                    className="flow-node protocol-node"
                    onClick={() => navigate('permissions')}
                  >
                    <Logo />
                    <strong>AgentPassport</strong>
                    <span>身份 · 授权 · 可验证凭证</span>
                    <small>
                      <span className="dot purple" /> SHARED TRUST LAYER
                    </small>
                  </button>
                  <div className="flow-arrow">
                    <span>按权限读取</span>
                    <div />
                    <ShieldCheck size={14} />
                  </div>
                  <button className="flow-node app-node" onClick={() => navigate('writer')}>
                    <div className="app-icon purple">
                      <SquarePen size={25} />
                    </div>
                    <strong>Writing Studio</strong>
                    <span>复用记忆，继续创作</span>
                    <small>APPLICATION 02</small>
                  </button>
                </div>
                <div className="flow-footer">
                  <LockKeyhole size={14} />
                  <span>敏感内容不上链。应用在读取前，独立核验链上授权。</span>
                  <button onClick={() => navigate('developers')}>
                    了解接入方式 <ArrowUpRight size={13} />
                  </button>
                </div>
              </section>
              <div className="overview-bottom">
                <section className="panel activity-panel">
                  <div className="panel-heading">
                    <h2>
                      最近活动 <span className="muted-count">{state.audit.length}</span>
                    </h2>
                    <button className="plain-link" onClick={() => navigate('receipts')}>
                      查看履历 <ArrowRight size={14} />
                    </button>
                  </div>
                  {state.audit.slice(0, 4).map((a) => (
                    <div className="activity" key={a.id}>
                      <span
                        className={`activity-icon ${a.type.includes('denied') || a.type.includes('revoked') ? 'orange' : 'purple'}`}
                      >
                        {a.type.includes('grant') ? (
                          <KeyRound size={16} />
                        ) : a.type === 'task_completed' ? (
                          <FileCheck2 size={16} />
                        ) : (
                          <Database size={16} />
                        )}
                      </span>
                      <div>
                        <strong>
                          {{
                            memory_saved: '记忆已加密保存',
                            grant_created: '已签发访问授权',
                            grant_revoked: '访问授权已撤销',
                            memory_read: '应用读取了授权记忆',
                            task_completed: '写作任务已完成',
                            access_denied: '越权访问已拒绝',
                          }[a.type] || a.type}
                        </strong>
                        <span>
                          {a.title || (a.appId === 'writer' ? 'Writing Studio' : 'Atlas Workspace')}
                        </span>
                      </div>
                      <time>{date(a.at)}</time>
                    </div>
                  ))}
                  {!state.audit.length && <div className="empty-mini">等待协议初始化…</div>}
                </section>
                <section className="getting-started">
                  <span className="eyebrow">MAKE IT YOURS</span>
                  <h2>
                    一份记忆，
                    <br />
                    更多可能。
                  </h2>
                  <p>
                    给写作助手签发一张通行证，
                    <br />
                    看看它如何接续研究助手的工作。
                  </p>
                  <div className="step-dots">
                    <span className="done">01 保存</span>
                    <span>02 授权</span>
                    <span>03 使用</span>
                  </div>
                  <Button variant="dark" onClick={openGrant}>
                    签发第一份授权 <ArrowUpRight size={16} />
                  </Button>
                  <div className="deco-orbit" />
                </section>
              </div>
            </>
          )}
          {page === 'memories' && (
            <>
              <PageHeading
                eyebrow="ENCRYPTED MEMORY VAULT"
                title="属于你的记忆。"
                description="为每段记忆保留独立权限。正文加密存储，完整性承诺留在链上。"
                action={
                  <Button onClick={() => navigate('research')}>
                    <Plus size={16} /> 添加记忆
                  </Button>
                }
              />
              <div className="section-toolbar">
                <div className="search-field">
                  <Search size={16} />
                  <input
                    aria-label="搜索记忆"
                    placeholder="搜索记忆名称…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <span className="subtle">
                  <LockKeyhole size={14} /> AES-256-GCM · {state.memories.length} 段记忆
                </span>
              </div>
              <div className="memory-grid">
                {displayedMemories.map((m) => (
                  <article className="memory-card" key={m.id}>
                    <div className="memory-card-top">
                      <span className={`soft-icon large ${KIND[m.kind].color}`}>
                        {m.kind === 'private' ? (
                          <LockKeyhole size={22} />
                        ) : m.kind === 'preferences' ? (
                          <Settings2 size={22} />
                        ) : (
                          <BookOpen size={22} />
                        )}
                      </span>
                      <Badge color={KIND[m.kind].color}>{KIND[m.kind].label}</Badge>
                    </div>
                    <span className="eyebrow">{KIND[m.kind].en}</span>
                    <h3>{m.title}</h3>
                    <p>
                      {m.kind === 'private'
                        ? '未分享的内容，保持私密。由你决定是否授权。'
                        : '来自研究助手的结构化记忆，可按范围分享给应用。'}
                    </p>
                    <div className="memory-meta">
                      <span>
                        <LockKeyhole size={12} /> {m.bytes} bytes · 已加密
                      </span>
                      <span>
                        {allowedMemories.has(m.id) ? '写作助手已获授权' : '尚未分享给写作助手'}
                      </span>
                    </div>
                    <div className="memory-card-footer">
                      <span>{date(m.createdAt)}</span>
                      <button onClick={() => openMemory(m)}>
                        查看记忆 <ArrowUpRight size={15} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {!displayedMemories.length && (
                <Empty
                  icon={Database}
                  title="没有找到记忆"
                  text="在研究助手中保存一段项目背景，或调整搜索关键词。"
                />
              )}
              <div className="info-strip">
                <ShieldCheck size={18} />
                <p>
                  <strong>加密的是正文，公开的是承诺。</strong>{' '}
                  记忆名称与访问元数据在演示控制台可见。加密密钥由本地 Vault
                  托管，当前版本尚未实现端到端加密。
                </p>
              </div>
            </>
          )}
          {page === 'permissions' && (
            <>
              <PageHeading
                eyebrow="SCOPED ACCESS CONTROL"
                title="通行有界，授权有期。"
                description="选择哪个应用、哪段记忆、多少次读取。随时撤销后续访问。"
                action={
                  <Button onClick={openGrant}>
                    <Plus size={16} /> 创建授权
                  </Button>
                }
              />
              <div className="permission-summary">
                <div>
                  <span className="soft-icon green">
                    <ShieldCheck size={22} />
                  </span>
                  <div>
                    <strong>{active.length} 份有效授权</strong>
                    <span>应用持有独立签名密钥，每次读取都核验权限</span>
                  </div>
                </div>
                <Button
                  variant="secondary danger-text"
                  onClick={() => revoke(active)}
                  disabled={!active.length || Boolean(busy)}
                >
                  {busy === 'revoke' ? <Spinner /> : <Trash2 size={15} />} 撤销全部有效授权
                </Button>
              </div>
              <section className="panel table-panel">
                <div className="panel-heading">
                  <h2>访问授权</h2>
                  <Badge>{state.grants.length} TOTAL</Badge>
                </div>
                {state.grants.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>应用 / 记忆</th>
                          <th>有效期至</th>
                          <th>剩余次数</th>
                          <th>状态</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.grants.map((g) => (
                          <tr key={g.id}>
                            <td>
                              <div className="table-identity">
                                <span
                                  className={`app-icon mini ${g.appId === 'writer' ? 'purple' : 'blue'}`}
                                >
                                  {g.appId === 'writer' ? (
                                    <SquarePen size={17} />
                                  ) : (
                                    <Search size={17} />
                                  )}
                                </span>
                                <div>
                                  <strong>
                                    {g.appId === 'writer' ? 'Writing Studio' : 'Research Studio'}
                                  </strong>
                                  <span>
                                    {state.memories.find((m) => m.id === g.memoryId)?.title ||
                                      short(g.memoryId)}
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td>{date(g.expiresAt)}</td>
                            <td>
                              <span className="mono">{g.remaining}</span>
                              <span className="subtle"> / {g.uses}</span>
                            </td>
                            <td>
                              <Status status={g.status} />
                            </td>
                            <td>
                              <button
                                className="plain-link danger-text"
                                disabled={g.revoked || Boolean(busy)}
                                onClick={() => revoke([g])}
                              >
                                撤销 <X size={13} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    icon={KeyRound}
                    title="访问权，等你签发"
                    text="默认不共享任何记忆。创建授权后，应用才能读取指定内容。"
                    action={
                      <Button onClick={openGrant}>
                        <Plus size={15} /> 创建授权
                      </Button>
                    }
                  />
                )}
              </section>
              <div className="info-strip">
                <Timer size={18} />
                <p>
                  撤销会阻止未来读取，无法收回应用已取得的明文。首次读取的链上确认，是明文释放的授权时点。
                </p>
              </div>
            </>
          )}
          {page === 'apps' && (
            <>
              <PageHeading
                eyebrow="CONNECTED APPLICATIONS"
                title="同一个你，不同的应用。"
                description="两个独立运行的示例服务，通过同一个 SDK 接入身份、授权和记忆。"
              />
              <div className="apps-grid">
                {(['research', 'writer'] as const).map((role) => (
                  <section className="panel application-card" key={role}>
                    <div className={`app-icon ${role === 'research' ? 'blue' : 'purple'}`}>
                      {role === 'research' ? <Search size={28} /> : <SquarePen size={28} />}
                    </div>
                    <Badge color="green">SDK 已接入</Badge>
                    <h2>{role === 'research' ? 'Research Studio' : 'Writing Studio'}</h2>
                    <span className="application-label">
                      {role === 'research' ? '研究助手 · 记忆的起点' : '写作助手 · 接续你的工作'}
                    </span>
                    <p>
                      {role === 'research'
                        ? '将项目背景、偏好与私密笔记保存为独立加密记忆。每段记忆生成链上完整性承诺。'
                        : '独立查询链上身份与授权，读取允许的记忆，并为文章生成签名输出凭证。'}
                    </p>
                    <div className="app-tech">
                      <span>独立进程</span>
                      <span>独立签名密钥</span>
                      <span>统一 SDK</span>
                    </div>
                    <div className="app-address">
                      <span>APPLICATION SIGNER</span>
                      <code>{short(config?.apps.find((a) => a.id === role)?.address, 12)}</code>
                    </div>
                    <div className="app-card-actions">
                      <Button onClick={() => navigate(role)}>
                        打开工作台 <ArrowRight size={15} />
                      </Button>
                      <a
                        className="plain-link"
                        href={`${config?.appUrls[role]}?agentId=${config?.agentId}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        独立窗口 <ExternalLink size={14} />
                      </a>
                    </div>
                  </section>
                ))}
              </div>
              <div className="info-strip">
                <Network size={18} />
                <p>
                  两个服务分别运行在本地端口 4392 和 4393。它们通过自己的签名身份和 RPC
                  读取协议，不持有 Vault 的记忆解密密钥。
                </p>
              </div>
            </>
          )}
          {page === 'research' && (
            <>
              <PageHeading
                eyebrow="APPLICATION 01 · RESEARCH STUDIO"
                title="把研究，变成可携带的记忆。"
                description="正文在传入保险箱后加密；每段记忆对应一个链上密文承诺。"
                action={
                  <Badge color="blue">
                    <Search size={13} /> 研究助手
                  </Badge>
                }
              />
              <div className="workspace-grid">
                <section className="panel form-panel">
                  <div className="panel-heading">
                    <h2>保存结构化记忆</h2>
                    <Badge>SDK INGEST</Badge>
                  </div>
                  <label>记忆类型</label>
                  <div className="kind-options">
                    {(Object.keys(KIND) as Kind[]).map((k) => (
                      <button
                        key={k}
                        className={researchKind === k ? 'selected' : ''}
                        onClick={() => setResearchKind(k)}
                      >
                        {k === 'private' ? <LockKeyhole size={15} /> : <Database size={15} />}{' '}
                        {KIND[k].label}
                      </button>
                    ))}
                  </div>
                  <label htmlFor="memory-title">记忆名称</label>
                  <input
                    id="memory-title"
                    className="form-input"
                    placeholder="例如：项目目标与用户需求"
                    maxLength={100}
                    value={researchTitle}
                    onChange={(e) => setResearchTitle(e.target.value)}
                  />
                  <label htmlFor="memory-content">记忆正文</label>
                  <textarea
                    id="memory-content"
                    className="form-textarea"
                    rows={9}
                    placeholder="写下需要保存的背景、偏好或笔记…"
                    maxLength={10000}
                    value={researchContent}
                    onChange={(e) => setResearchContent(e.target.value)}
                  />
                  <div className="form-bottom">
                    <span className="subtle">
                      <LockKeyhole size={13} /> 保存不会自动授权其他应用
                    </span>
                    <Button
                      onClick={saveResearch}
                      disabled={Boolean(busy) || !researchTitle.trim() || !researchContent.trim()}
                    >
                      {busy === 'save' ? <Spinner /> : <Plus size={16} />} 加密并保存
                    </Button>
                  </div>
                </section>
                <section className="panel workspace-aside">
                  <span className="eyebrow">YOUR MEMORY COLLECTION</span>
                  <h2>
                    已保存记忆 <span className="muted-count">{state.memories.length}</span>
                  </h2>
                  {state.memories.slice(0, 7).map((m) => (
                    <div className="collection-row" key={m.id}>
                      <span className={`soft-icon ${KIND[m.kind].color}`}>
                        <Database size={16} />
                      </span>
                      <div>
                        <strong>{m.title}</strong>
                        <span>
                          {KIND[m.kind].label} · {m.bytes} bytes
                        </span>
                      </div>
                      <LockKeyhole size={13} />
                    </div>
                  ))}
                  <div className="aside-note">
                    <Shield size={18} />
                    <p>
                      研究应用使用自己的密钥签名提交请求。只有预先登记的研究应用可以向此演示保险箱写入记忆。
                    </p>
                  </div>
                </section>
              </div>
            </>
          )}
          {page === 'writer' && (
            <>
              <PageHeading
                eyebrow="APPLICATION 02 · WRITING STUDIO"
                title="接着你的记忆，开始下一篇。"
                description="写作助手先检查授权，再读取资料。未授权的输入会让整个请求失败。"
                action={
                  <Badge color="purple">
                    <SquarePen size={13} /> 写作助手
                  </Badge>
                }
              />
              <div className="writer-layout">
                <section className="panel form-panel">
                  <div className="panel-heading">
                    <h2>新建写作任务</h2>
                    <Badge color={config?.llmConfigured ? 'green' : ''}>
                      {config?.llmConfigured ? 'LLM 已配置' : '模板演示 · 无模型调用'}
                    </Badge>
                  </div>
                  <label htmlFor="write-prompt">你想写什么？</label>
                  <textarea
                    id="write-prompt"
                    className="form-textarea prompt-textarea"
                    rows={3}
                    maxLength={500}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                  <label>选择本次使用的记忆</label>
                  <div className="write-memory-list">
                    {state.memories
                      .filter((m) => m.kind !== 'private')
                      .map((m) => (
                        <label className="check-row" key={m.id}>
                          <input
                            type="checkbox"
                            checked={writeMemories.includes(m.id)}
                            onChange={() =>
                              setWriteMemories((x) =>
                                x.includes(m.id) ? x.filter((id) => id !== m.id) : [...x, m.id],
                              )
                            }
                          />
                          <div>
                            <strong>{m.title}</strong>
                            <span>{KIND[m.kind].label}</span>
                          </div>
                          <Badge color={allowedMemories.has(m.id) ? 'green' : 'orange'}>
                            {allowedMemories.has(m.id) ? '已授权' : '未授权'}
                          </Badge>
                        </label>
                      ))}
                  </div>
                  <div className="form-bottom">
                    <span className="subtle">每段记忆消耗 1 次读取</span>
                    <Button
                      onClick={runWriter}
                      disabled={Boolean(busy) || !writeMemories.length || !prompt.trim()}
                    >
                      {busy === 'write' ? <Spinner /> : <Sparkles size={16} />}{' '}
                      {busy === 'write' ? '核验授权并生成…' : '读取记忆并生成'}
                    </Button>
                  </div>
                </section>
                <section className="security-test">
                  <span className="soft-icon orange">
                    <Shield size={23} />
                  </span>
                  <span className="eyebrow">TEST THE BOUNDARY</span>
                  <h2>让权限，经得起试探。</h2>
                  <p>模拟写作助手尝试读取一段私密笔记。协议将根据实际授权决定是否放行。</p>
                  <Button
                    variant="secondary"
                    onClick={probePrivate}
                    disabled={Boolean(busy) || !state.memories.some((m) => m.kind === 'private')}
                  >
                    {busy === 'probe' ? <Spinner /> : <LockKeyhole size={15} />} 测试私密记忆访问
                  </Button>
                  {probe && (
                    <div className={`probe-result ${probe.allowed ? 'allowed' : ''}`}>
                      {probe.allowed ? <Check size={17} /> : <ShieldCheck size={17} />}
                      <span>{probe.text}</span>
                    </div>
                  )}
                  <small>阻止本次读取不代表解决所有提示注入问题。</small>
                </section>
              </div>
              {task ? (
                <section className="panel output-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">VERIFIABLE OUTPUT</span>
                      <h2>{task.output.title}</h2>
                    </div>
                    <div className="output-actions">
                      <Button
                        variant="secondary"
                        onClick={() => void copy(task.output.text, 'article')}
                      >
                        {copied === 'article' ? <Check size={14} /> : <Copy size={14} />} 复制
                      </Button>
                      <Button variant="secondary" onClick={() => inspectReceipt(task.receipt)}>
                        <FileCheck2 size={14} /> 查看凭证
                      </Button>
                    </div>
                  </div>
                  <div className="output-source">
                    <Badge>{task.output.source}</Badge>
                    <span>{date(task.at)}</span>
                  </div>
                  <div className="article-text">{task.output.text}</div>
                  <div className="output-validation">
                    <span>
                      <CheckCheck size={16} /> 规则验证{' '}
                      {task.validation.passed ? '通过' : '存在未通过项'}
                    </span>
                    {task.validation.checks.map((c) => (
                      <Badge key={c.name} color={c.passed ? 'green' : 'orange'}>
                        {c.passed ? <Check size={12} /> : <CircleAlert size={12} />} {c.name}
                      </Badge>
                    ))}
                  </div>
                  <p className="validation-disclaimer">
                    验证者：应用自检规则。此凭证证明结果与签名的关联，不证明事实或推理正确。
                  </p>
                </section>
              ) : (
                <section className="panel">
                  <Empty
                    icon={SquarePen}
                    title="下一篇文章，从已有记忆开始"
                    text="先在授权管理中给写作助手签发权限，再运行任务。"
                    action={
                      !standalone ? (
                        <button className="plain-link" onClick={openGrant}>
                          去创建授权 <ArrowRight size={15} />
                        </button>
                      ) : undefined
                    }
                  />
                </section>
              )}
            </>
          )}
          {page === 'receipts' && (
            <>
              <PageHeading
                eyebrow="VERIFIABLE ACTIVITY"
                title="每次协作，留下可核验的依据。"
                description="读取凭证记录授权与签名；输出凭证绑定文章和验证结果。"
              />
              <div className="section-toolbar">
                <div className="search-field">
                  <Search size={16} />
                  <input
                    aria-label="搜索凭证"
                    placeholder="搜索任务或交易哈希…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <Badge>{state.receipts.length} RECEIPTS</Badge>
              </div>
              <section className="panel table-panel">
                {displayedReceipts.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>操作 / 关联内容</th>
                          <th>应用</th>
                          <th>链上区块</th>
                          <th>时间</th>
                          <th>凭证</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayedReceipts.map((r) => (
                          <tr key={r.id}>
                            <td>
                              <div className="table-identity">
                                <span
                                  className={`soft-icon ${r.type === 'result' ? 'purple' : 'blue'}`}
                                >
                                  {r.type === 'result' ? (
                                    <FileCheck2 size={17} />
                                  ) : (
                                    <Database size={17} />
                                  )}
                                </span>
                                <div>
                                  <strong>
                                    {r.type === 'result' ? '写作结果' : '授权记忆读取'}
                                  </strong>
                                  <span>{r.title}</span>
                                </div>
                              </div>
                            </td>
                            <td>{r.appId === 'writer' ? 'Writing Studio' : 'Research Studio'}</td>
                            <td>
                              <code>#{r.blockNumber}</code>
                            </td>
                            <td>{date(r.at)}</td>
                            <td>
                              <button
                                className="plain-link violet"
                                onClick={() => inspectReceipt(r)}
                              >
                                核验 <ArrowUpRight size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    icon={FileCheck2}
                    title="履历从真实操作开始"
                    text="应用首次读取记忆后，这里会显示可核验的链上凭证。"
                  />
                )}
              </section>
              <div className="info-strip">
                <Fingerprint size={18} />
                <p>
                  没有默认“信任分”。查看原始凭证、签名者和验证规则，由接入应用决定如何使用这些证据。
                </p>
              </div>
            </>
          )}
          {page === 'developers' && (
            <>
              <PageHeading
                eyebrow="BUILD WITH AGENTPASSPORT"
                title="连接记忆，只需一个 SDK。"
                description="让应用独立核验身份、授权与链上凭证，接续用户已积累的上下文。"
              />
              <div className="developer-grid">
                <section className="code-panel">
                  <header>
                    <span>
                      <Terminal size={16} /> TypeScript / JavaScript
                    </span>
                    <button onClick={() => void copy(sdkExample, 'sdk')}>
                      {copied === 'sdk' ? <Check size={15} /> : <Copy size={15} />}{' '}
                      {copied === 'sdk' ? '已复制' : '复制代码'}
                    </button>
                  </header>
                  <pre>
                    <code>{sdkExample}</code>
                  </pre>
                </section>
                <section className="panel dev-aside">
                  <h2>SDK 执行了什么？</h2>
                  {[
                    '从 RPC 查询 Agent 身份与授权',
                    '检查应用签名者、有效期和次数',
                    '签署带 nonce 的 EIP-712 请求',
                    'Vault 确认链上交易后释放正文',
                    '独立核验签名、链上状态及事件',
                  ].map((s, i) => (
                    <div className="dev-step" key={s}>
                      <span>{String(i + 1).padStart(2, '0')}</span>
                      <p>{s}</p>
                    </div>
                  ))}
                  <div className="aside-note">
                    <Code2 size={18} />
                    <p>当前为自定义 MVP 注册表。ERC-8004 兼容性属于后续工作，尚未宣称完整实现。</p>
                  </div>
                </section>
              </div>
              <section className="panel architecture">
                <div className="panel-heading">
                  <h2>清晰的信任边界</h2>
                  <Badge>PROTOCOL V0.1</Badge>
                </div>
                <div>
                  {[
                    {
                      icon: Network,
                      title: '链上协议',
                      text: '身份绑定、授权状态、密文哈希与签名凭证',
                    },
                    {
                      icon: Database,
                      title: '加密保险箱',
                      text: '密文存储、密钥托管、权限通过后解密',
                    },
                    {
                      icon: Layers3,
                      title: '应用层',
                      text: '独立签名、SDK 接入、模型调用及输出验证',
                    },
                  ].map((s) => (
                    <article key={s.title}>
                      <s.icon size={23} />
                      <h3>{s.title}</h3>
                      <p>{s.text}</p>
                    </article>
                  ))}
                </div>
              </section>
            </>
          )}
          <footer className="page-footer">
            <span>
              <Logo small /> AgentPassport <span className="footer-version">v0.2</span>
            </span>
            <span>
              {config?.mode === 'monad' ? 'Monad Testnet' : '本地 EVM 演示 · 尚未部署到 Monad'}
              <span className="footer-divider">/</span> 用户可控的跨应用记忆
            </span>
          </footer>
        </div>
      </main>
      {modal === 'wallet' && (
        <Modal title="连接你的钱包身份" close={() => setModal(null)}>
          <p className="modal-intro">
            钱包登录只验证你持有该地址。注册、授权和撤销会另外请求 EIP-712 签名；本地演示的 gas
            由中继支付。
          </p>
          {connectedWallet ? (
            <>
              <div className="detail-field">
                <span>CONNECTED WALLET</span>
                <code>{connectedWallet}</code>
              </div>
              {config?.controlMode === 'wallet' ? (
                <>
                  <Badge color="green">Agent #{config.agentId} · 钱包实际所有</Badge>
                  <div className="wallet-controls">
                    <Button
                      variant="secondary"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void act('ingestor', async () => {
                          await walletOperation(config, 'ingestor', { allowResearch: false });
                          notify('研究助手的新记忆写入权限已关闭');
                        })
                      }
                    >
                      停止研究助手写入
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void act('ingestor', async () => {
                          await walletOperation(config, 'ingestor', { allowResearch: true });
                          notify('研究助手的新记忆写入权限已启用');
                        })
                      }
                    >
                      允许研究助手写入
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={allowResearch}
                      onChange={(e) => setAllowResearch(e.target.checked)}
                    />
                    <div>
                      <strong>允许研究助手为新 Agent 保存记忆</strong>
                      <span>仅允许保存新记忆，不授予读取或管理权限；可随时关闭。</span>
                    </div>
                  </label>
                  <Button
                    disabled={!config || Boolean(busy)}
                    onClick={() =>
                      void act('register-wallet', async () => {
                        await walletOperation(config!, 'register', { allowResearch });
                        setWriteMemories([]);
                        setTask(null);
                        notify('钱包签名已验证，新的 Agent 已注册。请到研究助手保存第一段记忆。');
                      })
                    }
                  >
                    {busy === 'register-wallet' ? <Spinner /> : <Fingerprint size={15} />}{' '}
                    签名注册我的 Agent
                  </Button>
                </>
              )}
              <div className="modal-footer">
                <span>私钥不会传给服务端</span>
                <button
                  className="plain-link"
                  onClick={() => {
                    forgetWallet();
                    setConnectedWallet('');
                    setWriteMemories([]);
                    setTask(null);
                    setModal(null);
                    void reload();
                  }}
                >
                  返回演示工作空间
                </button>
              </div>
            </>
          ) : (
            <>
              <Button
                disabled={Boolean(busy)}
                onClick={() =>
                  void act('login-wallet', async () => {
                    const login = await loginWallet();
                    setConnectedWallet(login.address);
                    setWriteMemories([]);
                    setTask(null);
                    notify('钱包登录成功；尚未签发任何记忆授权');
                  })
                }
              >
                {busy === 'login-wallet' ? <Spinner /> : <Fingerprint size={15} />} 连接并签名登录
              </Button>
              <div className="deployment-guide">
                <h3>尚未安装钱包？</h3>
                <ol>
                  <li>用 Chrome / Edge 打开 MetaMask 官方下载页，添加浏览器扩展。</li>
                  <li>在扩展中创建自己的钱包，按提示完成备份。不要在本站或聊天中输入助记词。</li>
                  <li>用同一个浏览器打开当前链接，连接并签名登录。</li>
                  <li>点击“签名注册我的 Agent”，按钱包提示确认 Monad Testnet。</li>
                </ol>
                <p>项目中继支付测试网 gas，新钱包暂时无需充值。</p>
                <a
                  className="plain-link violet"
                  href="https://metamask.io/download"
                  target="_blank"
                  rel="noreferrer"
                >
                  MetaMask 官方下载 <ExternalLink size={13} />
                </a>
                <button
                  className="plain-link violet"
                  onClick={() => void copy(location.origin, 'browser-url')}
                >
                  复制当前访问地址 <Copy size={13} />
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
      {toast && (
        <div className={`toast ${toast.bad ? 'bad' : ''}`} role="status">
          {toast.bad ? <CircleAlert size={19} /> : <Check size={19} />}
          <span>{toast.text}</span>
          <button onClick={() => setToast(null)} aria-label="关闭通知">
            <X size={15} />
          </button>
        </div>
      )}
      {modal === 'grant' && (
        <Modal title="签发一份访问授权" close={() => setModal(null)}>
          <p className="modal-intro">应用只能读取你勾选的记忆，权限由链上合约核验。</p>
          <label>授权给哪个应用？</label>
          <select
            className="form-input"
            value={grantApp}
            onChange={(e) => setGrantApp(e.target.value)}
          >
            <option value="writer">Writing Studio · 写作助手</option>
            <option value="research">Research Studio · 研究助手</option>
          </select>
          <label>允许访问的记忆</label>
          <div className="grant-memory-list">
            {state.memories.map((m) => (
              <label className="check-row" key={m.id}>
                <input
                  type="checkbox"
                  checked={grantMemories.includes(m.id)}
                  onChange={() =>
                    setGrantMemories((x) =>
                      x.includes(m.id) ? x.filter((id) => id !== m.id) : [...x, m.id],
                    )
                  }
                />
                <div>
                  <strong>{m.title}</strong>
                  <span>{KIND[m.kind].label}</span>
                </div>
                {m.kind === 'private' ? (
                  <LockKeyhole size={16} className="orange-text" />
                ) : (
                  <Database size={16} />
                )}
              </label>
            ))}
          </div>
          {grantMemories.some(
            (id) => state.memories.find((m) => m.id === id)?.kind === 'private',
          ) && (
            <div className="inline-warning">
              <CircleAlert size={15} /> 已选择私密记忆，应用将能够读取其正文。
            </div>
          )}
          <div className="form-columns">
            <div>
              <label>有效期</label>
              <select
                className="form-input"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              >
                <option value={1}>1 分钟</option>
                <option value={10}>10 分钟</option>
                <option value={60}>1 小时</option>
                <option value={1440}>24 小时</option>
              </select>
            </div>
            <div>
              <label>每段记忆读取次数</label>
              <select
                className="form-input"
                value={uses}
                onChange={(e) => setUses(Number(e.target.value))}
              >
                <option value={1}>1 次</option>
                <option value={5}>5 次</option>
                <option value={10}>10 次</option>
                <option value={100}>100 次</option>
              </select>
            </div>
          </div>
          <div className="modal-footer">
            <span>
              {grantMemories.length} 段记忆 · {duration} 分钟
            </span>
            <Button onClick={createGrant} disabled={!grantMemories.length || Boolean(busy)}>
              {busy === 'grant' ? <Spinner /> : <KeyRound size={15} />} 签发链上授权
            </Button>
          </div>
        </Modal>
      )}
      {modal === 'network' && (
        <Modal title="网络与部署状态" close={() => setModal(null)}>
          {!config?.publicMode && <MonadSetup onError={(text) => notify(text, true)} />}
          <div className="network-status">
            <span className="soft-icon large purple">
              <Network size={24} />
            </span>
            <div>
              <strong>
                {config?.mode === 'monad' ? 'Monad Testnet' : 'Local EVM · 本地演示链'}
              </strong>
              <span>
                Chain ID {config?.chainId || '…'} · 区块 #{state.blockNumber}
              </span>
            </div>
            <Badge color="green">{config ? '已连接' : '连接中'}</Badge>
          </div>
          <p className="modal-intro">
            {config?.mode === 'monad'
              ? '当前操作提交到已配置的 Monad 测试网合约。'
              : '本地运行真实 Solidity 合约与签名交易。当前没有 Monad 测试网部署，不产生真实资金支出。'}
          </p>
          <div className="detail-field">
            <span>CONTRACT ADDRESS</span>
            <code>{config?.contractAddress}</code>
          </div>
          <div className="detail-field">
            <span>OWNER ADDRESS</span>
            <code>{config?.owner}</code>
          </div>
          <div className="detail-field">
            <span>IDENTITY REGISTRATION</span>
            {config && txLink(config.identityTx)}
          </div>
          {!config?.publicMode && (
            <div className="deployment-guide">
              <h3>切换至 Monad 测试网</h3>
              <ol>
                <li>配置 .env 中的测试网钱包与 RPC。</li>
                <li>
                  运行 <code>npm run deploy:monad</code>。
                </li>
                <li>填写合约地址，将 CHAIN_MODE 改为 monad。</li>
                <li>重启服务，核验真实交易与部署状态。</li>
              </ol>
              <small>完整配置和信任边界见项目 README。模型 API 为可选项。</small>
            </div>
          )}
        </Modal>
      )}
      {modal === 'memory' && selectedMemory && (
        <Modal title={selectedMemory.title} close={() => setModal(null)} wide>
          <div className="modal-badges">
            <Badge color={KIND[selectedMemory.kind].color}>{KIND[selectedMemory.kind].label}</Badge>
            <Badge color="green">
              <LockKeyhole size={12} /> AES-256-GCM
            </Badge>
            <Badge>OWNER VIEW</Badge>
          </div>
          {busy === 'memory' ? (
            <div className="loading">
              <Spinner /> 正在核验密文并解密…
            </div>
          ) : memoryDetail ? (
            <>
              <label>所有者解密视图</label>
              <div className="memory-plaintext">{memoryDetail.memory.content}</div>
              <label>实际存储的密文封装</label>
              <pre className="ciphertext">{JSON.stringify(memoryDetail.envelope, null, 2)}</pre>
            </>
          ) : (
            <p>无法读取记忆，请关闭后重试。</p>
          )}
          <div className="detail-field">
            <span>CIPHERTEXT COMMITMENT</span>
            <code>{selectedMemory.ciphertextHash}</code>
          </div>
          <div className="modal-footer">
            <span>仅在所有者视图解密显示</span>
            {txLink(selectedMemory.txHash)}
          </div>
        </Modal>
      )}
      {modal === 'receipt' && selectedReceipt && (
        <Modal title="核验操作凭证" close={() => setModal(null)} wide>
          <div className="receipt-summary">
            <span className="soft-icon large purple">
              <FileCheck2 size={24} />
            </span>
            <div>
              <strong>{selectedReceipt.title}</strong>
              <span>
                {selectedReceipt.type === 'result' ? '输出凭证' : '读取凭证'} · 区块 #
                {selectedReceipt.blockNumber}
              </span>
            </div>
          </div>
          <div className="detail-field">
            <span>TRANSACTION HASH</span>
            <code>{selectedReceipt.txHash}</code>
          </div>
          <div className="verify-actions">
            <Button onClick={verify} disabled={Boolean(busy)}>
              {busy === 'verify' ? <Spinner /> : <ShieldCheck size={16} />} 从链上核验
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                download(
                  selectedReceipt,
                  `agentpassport-receipt-${selectedReceipt.id.slice(2, 10)}.json`,
                )
              }
            >
              <Download size={15} /> 导出凭证 JSON
            </Button>
          </div>
          {verification && (
            <div className={`verification-result ${verification.valid ? 'valid' : ''}`}>
              <strong>{verification.valid ? '凭证验证通过' : '凭证验证失败'}</strong>
              <div>
                {Object.entries(verification.checks).map(([name, passed]) => (
                  <span key={name}>
                    {passed ? <Check size={14} /> : <X size={14} />}{' '}
                    {{
                      chain: '链 ID',
                      signature: '签名',
                      domain: '签名域',
                      transaction: '交易状态',
                      commitment: '链上承诺',
                      memory: '密文哈希',
                      application: '应用身份',
                      event: '交易事件',
                      content: '输出内容',
                    }[name] || name}
                  </span>
                ))}
              </div>
              <small>签名者：{short(verification.signer, 16)}</small>
            </div>
          )}
          <label>完整可导出凭证</label>
          <pre className="receipt-json">{JSON.stringify(selectedReceipt, null, 2)}</pre>
          <p className="validation-disclaimer">
            读取凭证证明访问请求在链上被接受。输出凭证证明应用对结果的签名与提交，不保证任务事实正确。
          </p>
        </Modal>
      )}
    </div>
  );
}
function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
function Empty({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: typeof Shield;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={27} strokeWidth={1.4} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
function Status({ status }: { status: Grant['status'] }) {
  return (
    <Badge color={status === 'active' ? 'green' : status === 'revoked' ? 'orange' : ''}>
      <span className={`dot ${status === 'active' ? 'green' : ''}`} />
      {{ active: '有效', revoked: '已撤销', expired: '已过期', exhausted: '次数用完' }[status]}
    </Badge>
  );
}
