import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  JVM_PRESETS,
  automaticInitialMemoryMiB,
  buildJvmArgs,
  inspectJvmArgs,
  parseJvmArgs,
  recommendedMaxMemoryMiB,
  validateJvmArgs,
  type CoreType,
  type DetectedJvmConfig,
  type JvmPresetId,
} from '@mystry/shared';
import { listNodes } from '../api';

export type DetectedJvmChoice = 'detected' | 'recommended' | 'custom' | null;

type Draft = {
  xmsMiB: number;
  xmxMiB: number;
  presetId: JvmPresetId;
  extraArgs: string;
  manualXms: boolean;
  rawMode: boolean;
};

function draftFromValue(value: string): Draft {
  const parsed = inspectJvmArgs(value);
  if (parsed.xmsMiB === null || parsed.xmxMiB === null) {
    return {
      xmsMiB: 1024,
      xmxMiB: 2048,
      presetId: 'custom',
      extraArgs: value,
      manualXms: true,
      rawMode: true,
    };
  }
  const automaticXms = automaticInitialMemoryMiB(parsed.presetId, parsed.xmxMiB);
  return {
    xmsMiB: parsed.xmsMiB,
    xmxMiB: parsed.xmxMiB,
    presetId: parsed.presetId,
    extraArgs: parsed.extraArgs,
    manualXms: parsed.xmsMiB !== automaticXms,
    rawMode: false,
  };
}

function buildDraftValue(draft: Draft): string {
  if (draft.rawMode) return draft.extraArgs;
  try {
    return buildJvmArgs(draft);
  } catch {
    const preset = JVM_PRESETS.find((item) => item.id === draft.presetId);
    return [
      `-Xms${Math.round(draft.xmsMiB)}M`,
      `-Xmx${Math.round(draft.xmxMiB)}M`,
      ...(preset?.args ?? []),
      draft.extraArgs,
    ].filter(Boolean).join(' ');
  }
}

export function JvmSettingsEditor({
  value,
  onChange,
  coreType,
  javaMajor,
  disabled = false,
  useRecommendedDefault = false,
  detectedJvmConfig,
  detectedChoice = null,
  onDetectedChoiceChange,
  onValidityChange,
}: {
  value: string;
  onChange: (value: string) => void;
  coreType: CoreType;
  javaMajor: number | null;
  disabled?: boolean;
  useRecommendedDefault?: boolean;
  detectedJvmConfig?: DetectedJvmConfig;
  detectedChoice?: DetectedJvmChoice;
  onDetectedChoiceChange?: (choice: DetectedJvmChoice) => void;
  onValidityChange?: (valid: boolean) => void;
}) {
  const maximumId = useId();
  const presetId = useId();
  const xmsId = useId();
  const extraId = useId();
  const [draft, setDraft] = useState<Draft>(() => draftFromValue(value));
  const [totalMemoryMiB, setTotalMemoryMiB] = useState<number | null>(null);
  const touchedRef = useRef(false);
  const recommendedAppliedRef = useRef(false);
  const lastEmittedRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    void listNodes()
      .then((nodes) => {
        if (!active) return;
        setTotalMemoryMiB(nodes.find((node) => node.isLocal)?.hostInfo?.totalMemMb ?? null);
      })
      .catch(() => {
        if (active) setTotalMemoryMiB(null);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (value === lastEmittedRef.current) {
      lastEmittedRef.current = null;
      return;
    }
    setDraft(draftFromValue(value));
  }, [value]);

  const recommendedMaximum = recommendedMaxMemoryMiB(totalMemoryMiB);

  useEffect(() => {
    if (
      !useRecommendedDefault
      || recommendedAppliedRef.current
      || touchedRef.current
      || totalMemoryMiB === null
    ) return;
    const parsed = inspectJvmArgs(value);
    if (
      parsed.xmsMiB !== 1024
      || parsed.xmxMiB !== 2048
      || parsed.presetId !== 'compatibility'
      || parsed.extraArgs
    ) return;
    recommendedAppliedRef.current = true;
    const next: Draft = {
      ...draft,
      xmxMiB: recommendedMaximum,
      xmsMiB: automaticInitialMemoryMiB(draft.presetId, recommendedMaximum),
    };
    const nextValue = buildDraftValue(next);
    setDraft(next);
    lastEmittedRef.current = nextValue;
    onChange(nextValue);
  }, [draft, onChange, recommendedMaximum, totalMemoryMiB, useRecommendedDefault, value]);

  const issues = useMemo(
    () => validateJvmArgs(value, { coreType, javaMajor, totalMemoryMiB }),
    [coreType, javaMajor, totalMemoryMiB, value],
  );
  const selectedPreset = JVM_PRESETS.find((item) => item.id === draft.presetId) ?? null;
  const needsDetectedChoice = Boolean(detectedJvmConfig && detectedChoice === null);
  const valid = !needsDetectedChoice && !issues.some((item) => item.severity === 'error');

  useEffect(() => {
    onValidityChange?.(valid);
  }, [onValidityChange, valid]);

  const tokens = useMemo(() => {
    try {
      return parseJvmArgs(value);
    } catch {
      return [];
    }
  }, [value]);

  const emit = (next: Draft, markTouched = true) => {
    if (markTouched) touchedRef.current = true;
    const normalizedDraft = next.manualXms
      ? next
      : { ...next, xmsMiB: automaticInitialMemoryMiB(next.presetId, next.xmxMiB) };
    const nextValue = buildDraftValue(normalizedDraft);
    setDraft(normalizedDraft);
    lastEmittedRef.current = nextValue;
    onChange(nextValue);
  };

  const chooseDetectedMode = (choice: Exclude<DetectedJvmChoice, null>) => {
    onDetectedChoiceChange?.(choice);
    if (choice === 'recommended') {
      emit({
        xmsMiB: Math.min(1024, recommendedMaximum),
        xmxMiB: recommendedMaximum,
        presetId: 'compatibility',
        extraArgs: '',
        manualXms: false,
        rawMode: false,
      });
      return;
    }
    if (choice === 'detected' && detectedJvmConfig?.canonicalArgs) {
      const next = draftFromValue(detectedJvmConfig.canonicalArgs);
      setDraft(next);
      lastEmittedRef.current = detectedJvmConfig.canonicalArgs;
      onChange(detectedJvmConfig.canonicalArgs);
      return;
    }
    if (choice === 'custom' && detectedJvmConfig) {
      const seed = detectedJvmConfig.canonicalArgs ?? detectedJvmConfig.raw;
      const next = draftFromValue(seed);
      emit(next);
    }
  };

  const fieldsDisabled = disabled || needsDetectedChoice;
  const g1Available = javaMajor !== null && [8, 17, 21].includes(javaMajor);
  const paperAvailable = coreType === 'paper' && g1Available;

  return (
    <section className="jvm-settings" aria-label="JVM 设置">
      {detectedJvmConfig && (
        <fieldset className="jvm-detected-choice" disabled={disabled}>
          <legend>检测到 user_jvm_args.txt，请确认处理方式</legend>
          <label>
            <input
              type="radio"
              name="detected-jvm-choice"
              checked={detectedChoice === 'detected'}
              disabled={!detectedJvmConfig.canonicalArgs}
              onChange={() => chooseDetectedMode('detected')}
            />
            沿用检测到的参数
          </label>
          <label>
            <input
              type="radio"
              name="detected-jvm-choice"
              checked={detectedChoice === 'recommended'}
              onChange={() => chooseDetectedMode('recommended')}
            />
            使用面板推荐
          </label>
          <label>
            <input
              type="radio"
              name="detected-jvm-choice"
              checked={detectedChoice === 'custom'}
              onChange={() => chooseDetectedMode('custom')}
            />
            自定义配置
          </label>
          {detectedJvmConfig.issues.map((item, index) => (
            <p key={`${item.code}-${index}`} className={item.severity === 'error' ? 'error' : 'field-warn'}>
              {item.message}
            </p>
          ))}
        </fieldset>
      )}

      {draft.rawMode ? (
        <div className="field">
          <label htmlFor={extraId}>原始 JVM 参数（修正错误后会恢复引导模式）</label>
          <textarea
            id={extraId}
            rows={5}
            value={value}
            disabled={fieldsDisabled}
            onChange={(event) => {
              touchedRef.current = true;
              const nextValue = event.target.value;
              lastEmittedRef.current = nextValue;
              onChange(nextValue);
              const parsed = inspectJvmArgs(nextValue);
              if (parsed.canonicalArgs) setDraft(draftFromValue(parsed.canonicalArgs));
            }}
          />
        </div>
      ) : (
        <>
          <div className="grid grid-2 jvm-basic-grid">
            <div className="field">
              <label htmlFor={maximumId}>最大内存（MiB）</label>
              <input
                id={maximumId}
                type="number"
                min={512}
                step={512}
                value={draft.xmxMiB}
                disabled={fieldsDisabled}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (Number.isFinite(next) && next > 0) emit({ ...draft, xmxMiB: next });
                }}
              />
              <p className="muted field-help">
                推荐 {recommendedMaximum} MiB
                {totalMemoryMiB ? ` · 主机总内存约 ${Math.round(totalMemoryMiB / 1024)} GiB` : ' · 未读取到主机内存'}
              </p>
            </div>
            <div className="field">
              <label htmlFor={presetId}>优化方案</label>
              <select
                id={presetId}
                value={draft.presetId}
                disabled={fieldsDisabled}
                onChange={(event) => {
                  const nextPreset = event.target.value as JvmPresetId;
                  emit({ ...draft, presetId: nextPreset });
                }}
              >
                <option value="compatibility">兼容优先</option>
                <option value="g1-balanced" disabled={!g1Available}>G1 均衡</option>
                <option value="paper-aikar" disabled={!paperAvailable}>Paper Aikar</option>
                <option value="custom">自定义（不附加预设）</option>
              </select>
              <p className="muted field-help">
                {selectedPreset?.description ?? '保留无法归类的自定义参数。'}
              </p>
              {selectedPreset?.sourceUrl ? (
                <p className="muted field-help">
                  冻结版本 {selectedPreset.version} · 复核于 {selectedPreset.reviewedAt} ·{' '}
                  <a href={selectedPreset.sourceUrl} target="_blank" rel="noreferrer">查看官方来源</a>
                </p>
              ) : null}
            </div>
          </div>

          <details className="jvm-advanced">
            <summary>高级 JVM 参数</summary>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={draft.manualXms}
                disabled={fieldsDisabled}
                onChange={(event) => emit({ ...draft, manualXms: event.target.checked })}
              />
              手动设置初始内存 Xms
            </label>
            <div className="field">
              <label htmlFor={xmsId}>初始内存（MiB）</label>
              <input
                id={xmsId}
                type="number"
                min={512}
                step={512}
                value={draft.xmsMiB}
                disabled={fieldsDisabled || !draft.manualXms}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (Number.isFinite(next) && next > 0) emit({ ...draft, xmsMiB: next });
                }}
              />
            </div>
            <div className="field">
              <label htmlFor={extraId}>附加参数</label>
              <textarea
                id={extraId}
                rows={4}
                value={draft.extraArgs}
                disabled={fieldsDisabled}
                placeholder="例如 -Dfile.encoding=UTF-8"
                onChange={(event) => emit({ ...draft, extraArgs: event.target.value })}
              />
              <p className="muted field-help">内存和启动目标由面板管理，请勿在这里重复填写。</p>
            </div>
          </details>
        </>
      )}

      <div className="jvm-args-preview" aria-label="最终 JVM 参数">
        <strong>最终参数</strong>
        {tokens.length > 0 ? (
          <div className="jvm-token-list">
            {tokens.map((token, index) => <code key={`${token}-${index}`}>{token}</code>)}
          </div>
        ) : (
          <code>{value || '暂无可解析参数'}</code>
        )}
      </div>
      {issues.map((item, index) => (
        <p
          key={`${item.code}-${index}`}
          className={item.severity === 'error' ? 'error' : 'field-warn'}
          role={item.severity === 'error' ? 'alert' : undefined}
        >
          {item.message}
        </p>
      ))}
    </section>
  );
}
