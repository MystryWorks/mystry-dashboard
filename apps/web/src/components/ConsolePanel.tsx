import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { createConsoleTicket } from '../api';

type Props = {
  instanceId: string;
  onStatus?: (status: string) => void;
};

export function ConsolePanel({ instanceId, onStatus }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      convertEol: true,
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
          if (!disposed) term.writeln('\r\n[面板] 控制台连接已断开');
        };
      } catch (err) {
        if (disposed || (err instanceof Error && err.name === 'AbortError')) return;
        term.writeln(`\r\n[错误] ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    void connect();

    let cmdBuffer = '';
    const disposable = term.onData((data) => {
      if (data === '\r') {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'command', data: cmdBuffer }));
        }
        term.write('\r\n');
        cmdBuffer = '';
        return;
      }
      if (data === '\u007f') {
        if (cmdBuffer.length > 0) {
          cmdBuffer = cmdBuffer.slice(0, -1);
          term.write('\b \b');
        }
        return;
      }
      cmdBuffer += data;
      term.write(data);
    });

    const onResize = () => fit.fit();
    window.addEventListener('resize', onResize);

    return () => {
      disposed = true;
      ticketRequest.abort();
      disposable.dispose();
      window.removeEventListener('resize', onResize);
      ws?.close();
      term.dispose();
      termRef.current = null;
      wsRef.current = null;
    };
  }, [instanceId, onStatus]);

  return (
    <div className="console-wrap">
      <div ref={containerRef} />
    </div>
  );
}
