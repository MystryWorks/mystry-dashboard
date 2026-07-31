import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { createConsoleTicket } from '../api';

type Props = {
  instanceId: string;
  canSend?: boolean;
  onStatus?: (status: string) => void;
};

export function ConsolePanel({ instanceId, canSend = true, onStatus }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const draftRef = useRef('');

  const [command, setCommand] = useState('');
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      convertEol: true,
      disableStdin: true,
      cursorBlink: false,
      fontFamily: 'IBM Plex Mono, monospace',
      fontSize: 13,
      theme: {
        background: '#0a0f0d',
        foreground: '#d7e6dc',
        cursor: '#3dba7e',
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
          if (!disposed) setConnected(true);
        };

        ws.onmessage = (ev) => {
          if (disposed) return;
          try {
            const msg = JSON.parse(String(ev.data)) as {
              type: string;
              data: string;
              status?: string;
            };
            if (msg.type === 'history' || msg.type === 'output') {
              term.write(msg.data);
            }
            if (msg.type === 'error') {
              term.writeln(`\r\n[错误] ${msg.data}`);
            }
            if (msg.status && onStatus) onStatus(msg.status);
          } catch {
            term.write(String(ev.data));
          }
        };

        ws.onclose = () => {
          if (!disposed) {
            setConnected(false);
            term.writeln('\r\n[面板] 控制台连接已断开');
          }
        };
      } catch (err) {
        if (disposed || (err instanceof Error && err.name === 'AbortError')) return;
        setConnected(false);
        term.writeln(`\r\n[错误] ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    void connect();

    const onResize = () => fit.fit();
    window.addEventListener('resize', onResize);

    return () => {
      disposed = true;
      ticketRequest.abort();
      window.removeEventListener('resize', onResize);
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

  return (
    <div className="console-wrap">
      <div className="console-output" ref={containerRef} />
      <form className="console-input-bar" onSubmit={onSubmit}>
        <span className="console-prompt" aria-hidden="true">
          &gt;
        </span>
        <input
          className="console-input"
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!inputEnabled}
          placeholder={inputEnabled ? '输入指令…' : canSend ? '连接中…' : '实例未运行'}
          autoComplete="off"
          spellCheck={false}
          aria-label="控制台指令"
        />
        <button className="btn console-send" type="submit" disabled={!inputEnabled || !command.trim()}>
          发送
        </button>
      </form>
    </div>
  );
}
