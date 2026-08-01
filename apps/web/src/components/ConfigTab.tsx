import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

/**
 * server.properties 引导化编辑器：
 * 常用配置按分组展示为中文标签 + 开关/下拉/数字控件；
 * 未收录的键折叠进「高级选项」保留原始文本编辑。
 * 保存仍提交完整的键值记录，未展示的键不会被丢弃。
 */

type FieldType = 'text' | 'number' | 'boolean' | 'select';

interface FieldMeta {
  key: string;
  label: string;
  desc: string;
  type: FieldType;
  options?: { value: string; label: string }[];
}

interface GroupMeta {
  title: string;
  fields: FieldMeta[];
}

const GROUPS: GroupMeta[] = [
  {
    title: '基础设置',
    fields: [
      { key: 'motd', label: '服务器简介', desc: '显示在多人游戏服务器列表中的介绍文字。', type: 'text' },
      { key: 'server-port', label: '服务器端口', desc: '默认 25565；修改后玩家需要使用新端口连接。', type: 'number' },
      { key: 'max-players', label: '最大在线人数', desc: '允许同时在线的玩家数量上限。', type: 'number' },
      {
        key: 'difficulty', label: '难度', desc: '影响怪物伤害与饥饿等生存压力。', type: 'select',
        options: [
          { value: 'peaceful', label: '和平' },
          { value: 'easy', label: '简单' },
          { value: 'normal', label: '普通' },
          { value: 'hard', label: '困难' },
        ],
      },
      {
        key: 'gamemode', label: '默认游戏模式', desc: '新玩家进入时的游戏模式。', type: 'select',
        options: [
          { value: 'survival', label: '生存' },
          { value: 'creative', label: '创造' },
          { value: 'adventure', label: '冒险' },
          { value: 'spectator', label: '旁观' },
        ],
      },
      { key: 'force-gamemode', label: '强制默认游戏模式', desc: '开启后，玩家每次进入都会被重置为默认游戏模式。', type: 'boolean' },
    ],
  },
  {
    title: '多人与权限',
    fields: [
      { key: 'online-mode', label: '正版验证（在线模式）', desc: '开启后仅允许正版账号登录。关闭可允许离线账号进入，但任何人都能冒用任意用户名，存在安全风险。', type: 'boolean' },
      { key: 'white-list', label: '启用白名单', desc: '开启后仅白名单内的玩家可以进入服务器。', type: 'boolean' },
      { key: 'pvp', label: '玩家对战（PVP）', desc: '关闭后玩家之间无法造成伤害。', type: 'boolean' },
      { key: 'allow-flight', label: '允许飞行', desc: '开启后容忍飞行，避免使用鞘翅或飞行模组时被误判踢出。', type: 'boolean' },
      { key: 'op-permission-level', label: 'OP 权限等级', desc: '1-4，4 为最高，可执行全部管理命令。', type: 'number' },
    ],
  },
  {
    title: '世界',
    fields: [
      { key: 'level-name', label: '世界文件夹名称', desc: '更换后会生成或加载另一个世界文件夹。', type: 'text' },
      { key: 'level-seed', label: '世界种子', desc: '留空则随机生成；仅对新生成的世界生效。', type: 'text' },
      { key: 'allow-nether', label: '开启下界', desc: '关闭后下界传送门将无法使用。', type: 'boolean' },
      { key: 'spawn-monsters', label: '生成怪物', desc: '和平难度下此项无效。', type: 'boolean' },
      { key: 'spawn-animals', label: '生成动物', desc: '控制动物是否自然生成。', type: 'boolean' },
      { key: 'spawn-protection', label: '出生点保护半径', desc: '非 OP 玩家无法在此半径（方块数）内破坏，0 表示关闭。', type: 'number' },
    ],
  },
  {
    title: '性能',
    fields: [
      { key: 'view-distance', label: '视距（区块）', desc: '玩家可见的区块范围，越大越耗内存与带宽，默认 10。', type: 'number' },
      { key: 'simulation-distance', label: '模拟距离（区块）', desc: '实体与方块实际更新的范围，默认 10；较低版本核心可能不存在此项。', type: 'number' },
      { key: 'network-compression-threshold', label: '网络压缩阈值', desc: '数据包超过该字节数才压缩，-1 表示关闭压缩。', type: 'number' },
    ],
  },
];

export function ConfigTab({ instanceId }: { instanceId: string }) {
  const [props, setProps] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setProps({});
    setError('');
    setSaved(false);
    setLoaded(false);
    void api<Record<string, string>>(`/api/instances/${instanceId}/config/server.properties`, {
      signal: controller.signal,
    })
      .then((nextProps) => {
        if (controller.signal.aborted) return;
        setProps(nextProps);
        setLoaded(true);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => controller.abort();
  }, [instanceId]);

  async function save() {
    if (!loaded || saving) return;
    setSaving(true);
    setSaved(false);
    try {
      await api(`/api/instances/${instanceId}/config/server.properties`, {
        method: 'PUT',
        json: props,
      });
      setSaved(true);
      setError('');
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const knownKeys = useMemo(
    () => new Set(GROUPS.flatMap((group) => group.fields.map((field) => field.key))),
    [],
  );
  const advancedKeys = Object.keys(props).filter((key) => !knownKeys.has(key)).sort();

  function setValue(key: string, value: string) {
    setProps((prev) => ({ ...prev, [key]: value }));
  }

  function renderField(field: FieldMeta) {
    const raw = props[field.key];
    const inputId = `server-property-${field.key}`;
    const disabled = !loaded || saving;
    return (
      <div className="field" key={field.key}>
        {field.type === 'boolean' ? (
          <label className="config-bool">
            <input
              type="checkbox"
              checked={(raw ?? 'false') === 'true'}
              disabled={disabled}
              onChange={(e) => setValue(field.key, e.target.checked ? 'true' : 'false')}
            />
            {field.label}
          </label>
        ) : (
          <>
            <label htmlFor={inputId}>{field.label}</label>
            {field.type === 'select' ? (
              <select
                id={inputId}
                value={raw ?? ''}
                disabled={disabled}
                onChange={(e) => setValue(field.key, e.target.value)}
              >
                <option value="" disabled>
                  请选择
                </option>
                {field.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={inputId}
                type={field.type === 'number' ? 'number' : 'text'}
                value={raw ?? ''}
                disabled={disabled}
                onChange={(e) => setValue(field.key, e.target.value)}
              />
            )}
          </>
        )}
        <p className="config-field-desc">{field.desc}</p>
      </div>
    );
  }

  return (
    <div className="config-workspace panel">
      <div className="config-workspace-header">
        <p className="page-desc">编辑 server.properties（修改后需重启实例生效）。</p>
        {error && <p className="error">{error}</p>}
        {saved && <p className="muted">已保存</p>}
        {!loaded && !error && <p className="muted">正在读取配置…</p>}
      </div>

      <div className="config-fields">
        {GROUPS.map((group) => (
          <section className="config-group" key={group.title}>
            <h3>{group.title}</h3>
            <div className="config-group-fields">{group.fields.map(renderField)}</div>
          </section>
        ))}

        {advancedKeys.length > 0 && (
          <details className="config-advanced">
            <summary>高级选项（{advancedKeys.length} 项未收录配置）</summary>
            <div className="config-group-fields">
              {advancedKeys.map((key) => {
                const inputId = `server-property-${key}`;
                return (
                  <div className="field" key={key}>
                    <label htmlFor={inputId}>{key}</label>
                    <input
                      id={inputId}
                      value={props[key] ?? ''}
                      disabled={!loaded || saving}
                      onChange={(e) => setValue(key, e.target.value)}
                    />
                  </div>
                );
              })}
            </div>
          </details>
        )}
      </div>

      <div className="config-workspace-footer">
        <button className="btn" type="button" disabled={!loaded || saving} onClick={() => void save()}>
          {saving ? '保存中…' : '保存配置'}
        </button>
      </div>
    </div>
  );
}
