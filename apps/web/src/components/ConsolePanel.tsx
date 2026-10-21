import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Copy, Eraser, Send } from 'lucide-react';
import { createConsoleTicket } from '../api';
import {
  colorizeConsoleLine,
  colorizeConsoleStream,
  createConsoleColorizeState,
  flushConsoleColorize,
} from '../console-colorize';

type Props = {
  instanceId: string;
  canSend?: boolean;
  onStatus?: (status: string) => void;
};

const QUICK_COMMANDS = [
  { label: 'list', desc: '玩家列表', cmd: 'list' },
  { label: 'save-all', desc: '保存世界', cmd: 'save-all' },
  { label: 'tps', desc: '刻率性能', cmd: 'tps' },
  { label: 'whitelist list', desc: '白名单', cmd: 'whitelist list' },
  { label: 'help', desc: '命令帮助', cmd: 'help' },
];

export function ConsolePanel({ instanceId, canSend = true, onStatus }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const draftRef = useRef('');

  const [command, setCommand] = useState('');
  const [connected, setConnected] = useState(false);
  const [copyMessage, setCopyMessage] = useState('');
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyRequestRef = useRef(0);

  useEffect(() => () => {
    copyRequestRef.current += 1;
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, [instanceId]);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      convertEol: true,
      disableStdin: true,
      cursorBlink: false,
      fontFamily: 'IBM Plex Mono, monospace',
      fontSize: 13,
      theme: {
        background: '#070508',
        foreground: '#f0e6ed',
        cursor: '#f062a6',
        black: '#070508',
        red: '#ff5d7d',
        green: '#65d6a0',
        yellow: '#e0a84a',
        blue: '#64b5f6',
        magenta: '#d67ae0',
        cyan: '#56d4dd',
        white: '#fff1f8',
        brightBlack: '#6b5765',
        brightRed: '#ff7691',
        brightGreen: '#7ee2b0',
        brightYellow: '#eec26f',
        brightBlue: '#8ac4f8',
        brightMagenta: '#e297ea',
        brightCyan: '#7ae2ea',
        brightWhite: '#ffffff',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;

    let disposed = false;
    let ws: WebSocket | null = null;
    const ticketRequest = new AbortController();
    const colorState = createConsoleColorizeState();
    let retryAttempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

    const writeColored = (chunk: string, flush = false) => {
      const colored = colorizeConsoleStream(chunk, colorState);
      if (colored) term.write(colored);
      if (flush) {
        const rest = flushConsoleColorize(colorState);
        if (rest) term.write(rest);
      }
    };

    const writeSystemLine = (line: string) => {
      const rest = flushConsoleColorize(colorState);
      if (rest) term.write(rest);
      term.write('\r\n');
      term.writeln(colorizeConsoleLine(line));
    };

    const scheduleReconnect = (reason: string) => {
      if (disposed) return;
      const delay = RETRY_DELAYS_MS[Math.min(retryAttempt, RETRY_DELAYS_MS.length - 1)];
      retryAttempt += 1;
      writeSystemLine(`[面板] ${reason}，${Math.round(delay / 1000)} 秒后重连…`);
      retryTimer = setTimeout(() => void connect(), delay);
    };

    const connect = async () => {
      try {
        const { ticket } = await createConsoleTicket(instanceId, ticketRequest.signal);
        if (disposed) return;

        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        ws = new WebSocket(
          `${proto}://${location.host}/ws/console/${encodeURIComponent(instanceId)}?ticket=${encodeURIComponent(ticket)}`,
        );
        wsRef.current = ws;

        ws.onopen = () => {
          if (disposed) return;
          if (retryAttempt > 0) writeSystemLine('[面板] 控制台已重新连接');
          retryAttempt = 0;
          setConnected(true);
        };

        ws.onmessage = (ev) => {
          if (disposed) return;
          try {
            const msg = JSON.parse(String(ev.data)) as {
              type: string;
              data: string;
              status?: string;
            };
            if (msg.type === 'history') {
              writeColored(msg.data, true);
            } else if (msg.type === 'output') {
              writeColored(msg.data);
            }
            if (msg.type === 'error') {
              writeSystemLine(`[错误] ${msg.data}`);
            }
            if (msg.status && onStatus) onStatus(msg.status);
          } catch {
            writeColored(String(ev.data));
          }
        };

        ws.onclose = () => {
          if (disposed) return;
          setConnected(false);
          scheduleReconnect('控制台连接已断开');
        };
      } catch (err) {
        if (disposed || (err instanceof Error && err.name === 'AbortError')) return;
        setConnected(false);
        scheduleReconnect(err instanceof Error ? err.message : String(err));
      }
    };

    void connect();

    const onResize = () => fit.fit();
    window.addEventListener('resize', onResize);

    return () => {
      disposed = true;
      ticketRequest.abort();
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener('resize', onResize);
      flushConsoleColorize(colorState);
      ws?.close();
      term.dispose();
      termRef.current = null;
      wsRef.current = null;
      setConnected(false);
    };
  }, [instanceId, onStatus]);

  const inputEnabled = canSend && connected;

  function sendCommand(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({ type: 'command', data: trimmed }));
    const history = historyRef.current;
    if (history[history.length - 1] !== trimmed) {
      history.push(trimmed);
      if (history.length > 50) history.shift();
    }
    historyIndexRef.current = -1;
    draftRef.current = '';
    setCommand('');
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!inputEnabled) return;
    sendCommand(command);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const history = historyRef.current;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      if (historyIndexRef.current === -1) {
        draftRef.current = command;
        historyIndexRef.current = history.length - 1;
      } else if (historyIndexRef.current > 0) {
        historyIndexRef.current -= 1;
      }
      setCommand(history[historyIndexRef.current] || '');
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndexRef.current === -1) return;
      if (historyIndexRef.current < history.length - 1) {
        historyIndexRef.current += 1;
        setCommand(history[historyIndexRef.current] || '');
      } else {
        historyIndexRef.current = -1;
        setCommand(draftRef.current);
      }
    }
  }

  function clearScreen() {
    termRef.current?.clear();
  }

  async function copyAll() {
    const requestId = ++copyRequestRef.current;
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    const term = termRef.current;
    let message = '暂无可复制的日志。';
    try {
      term?.selectAll();
      const text = term?.getSelection() ?? '';
      term?.clearSelection();
      if (text.trim()) {
        if (!navigator.clipboard?.writeText) throw new Error('剪贴板不可用');
        await navigator.clipboard.writeText(text);
        message = '日志已复制。';
      }
    } catch {
      message = '复制失败：浏览器剪贴板不可用或权限被拒绝，请手动选择日志并复制。';
    }
    if (requestId !== copyRequestRef.current) return;
    setCopyMessage(message);
    copyTimerRef.current = setTimeout(() => setCopyMessage(''), 6000);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div className="console-box-wrapper">
        <div className="console-header-bar">
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.84rem' }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: connected ? 'var(--ok)' : 'var(--warn)',
                boxShadow: connected ? '0 0 8px var(--ok)' : 'none',
              }}
            />
            <span>{connected ? '实时输出日志 · WebSocket 已连接' : canSend ? '控制台正在连接…' : '实例未运行'}</span>
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="btn btn-icon"
              type="button"
              title="清空屏幕"
              onClick={clearScreen}
              style={{ width: 30, height: 30 }}
            >
              <Eraser size={14} />
            </button>
            <button
              className="btn"
              type="button"
              title="复制全部输出"
              onClick={() => void copyAll()}
              style={{ height: 30, padding: '0 10px', fontSize: '0.78rem' }}
            >
              <Copy size={13} />
              复制日志
            </button>
          </div>
        </div>

        <p role="status" aria-live="polite" className="console-copy-status">{copyMessage}</p>
        <div className="console-output" ref={containerRef} />

        <form className="console-input-bar" onSubmit={onSubmit}>
          <span className="console-prompt" aria-hidden="true" style={{ color: 'var(--accent)', fontWeight: 700 }}>
            &gt;
          </span>
          <input
            className="console-input"
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={!inputEnabled}
            placeholder={inputEnabled ? '输入控制台命令 (如: list, say Hello, op player) 按回车发送' : canSend ? '连接中…' : '实例已停止，启动后可发送指令'}
            autoComplete="off"
            spellCheck={false}
            aria-label="控制台指令"
          />
          <button className="btn btn-primary" type="submit" disabled={!inputEnabled || !command.trim()} style={{ height: 36 }}>
            <Send size={14} />
            发送
          </button>
        </form>
      </div>

      {/* 快捷指令按钮栏 */}
      <div className="quick-cmd-bar">
        <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>常用命令快捷键：</span>
        {QUICK_COMMANDS.map((item) => (
          <button
            key={item.cmd}
            type="button"
            className="btn"
            disabled={!inputEnabled}
            style={{ height: 30, padding: '0 12px', fontSize: '0.8rem' }}
            onClick={() => sendCommand(item.cmd)}
            title={`向服务器发送 /${item.cmd}`}
          >
            {item.label} ({item.desc})
          </button>
        ))}
      </div>
    </div>
  );
}
