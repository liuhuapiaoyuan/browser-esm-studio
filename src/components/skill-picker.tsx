import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { SkillId, SkillSummary } from "../lib/ai/skills/registry";

type SkillPickerProps = {
  skills: SkillSummary[];
  requestedIds: readonly SkillId[];
  activeIds: readonly SkillId[];
  requiredBy: Readonly<Record<SkillId, SkillId[]>>;
  disabled?: boolean;
  onChange: (ids: SkillId[]) => void;
};

const SKILL_ACCENT: Record<string, string> = {
  sandbox: "#7cb342",
  "dynamic-db": "#42a5f5",
  "lite-image": "#ab47bc",
  "interactive-quest": "#ffa726",
  "quest-learning": "#26a69a",
};

export function updateRequestedSkillIds(
  skills: readonly SkillSummary[],
  requestedIds: readonly SkillId[],
  id: SkillId,
  checked: boolean,
): SkillId[] {
  const next = new Set(requestedIds);
  if (checked) next.add(id);
  else next.delete(id);
  return skills.filter((skill) => next.has(skill.id)).map((skill) => skill.id);
}

export function isSkillDependencyLocked(
  requiredBy: Readonly<Record<SkillId, SkillId[]>>,
  id: SkillId,
): boolean {
  return (requiredBy[id]?.length ?? 0) > 0;
}

export function snapshotSkillIds(skillIds: readonly SkillId[]): SkillId[] {
  return [...skillIds];
}

function skillInitial(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return "?";
  const first = trimmed.codePointAt(0);
  return first ? String.fromCodePoint(first).toUpperCase() : "?";
}

export function SkillPicker({
  skills,
  requestedIds,
  activeIds,
  requiredBy,
  disabled = false,
  onChange,
}: SkillPickerProps) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const descriptionId = `${dialogId}-description`;
  const active = useMemo(() => new Set(activeIds), [activeIds]);
  const byId = useMemo(() => new Map(skills.map((skill) => [skill.id, skill])), [skills]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function toggle(id: SkillId, checked: boolean) {
    onChange(updateRequestedSkillIds(skills, requestedIds, id, checked));
  }

  const dialog = open ? (
    <div className="skill-store-overlay" onClick={() => setOpen(false)}>
      <div
        ref={dialogRef}
        className="skill-store-dialog"
        id={dialogId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="skill-store-header">
          <div className="skill-store-heading">
            <h2 id={titleId}>技能商店</h2>
            <p id={descriptionId}>为本轮对话挑选 Agent 技能。仅已加载技能会注册对应 CLI 能力。</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="skill-store-close"
            aria-label="关闭技能商店"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </header>

        <div className="skill-store-grid" role="group" aria-label="可选 Agent 技能">
          {skills.map((skill) => {
            const dependents = requiredBy[skill.id] ?? [];
            const locked = isSkillDependencyLocked(requiredBy, skill.id);
            const isActive = active.has(skill.id);
            const dependencyLabels = dependents.map((id) => byId.get(id)?.title ?? id);
            const requiresLabels = skill.requires.map((id) => byId.get(id)?.title ?? id);
            const accent = SKILL_ACCENT[skill.id] ?? "#8fbc5a";

            return (
              <article
                key={skill.id}
                className={`skill-store-card ${isActive ? "is-active" : ""} ${locked ? "is-locked" : ""}`}
                style={{ "--skill-accent": accent } as CSSProperties}
              >
                <div className="skill-store-card-top">
                  <div className="skill-store-card-icon" aria-hidden="true">
                    {skillInitial(skill.title)}
                  </div>
                  <div className="skill-store-card-badges">
                    {skill.defaultEnabled ? <span className="is-builtin">内置</span> : null}
                    {locked ? <span className="is-auto">自动</span> : null}
                    {isActive ? <span className="is-loaded">已加载</span> : null}
                  </div>
                </div>

                <h3>{skill.title}</h3>
                <p>{skill.description}</p>

                <div className="skill-store-card-meta">
                  {locked ? <em>由 {dependencyLabels.join("、")} 自动加载</em> : null}
                  {!locked && skill.requires.length ? (
                    <em>同时加载 {requiresLabels.join("、")}</em>
                  ) : null}
                </div>

                <button
                  type="button"
                  className="skill-store-card-action"
                  disabled={disabled || locked}
                  aria-pressed={isActive}
                  onClick={() => toggle(skill.id, !isActive)}
                >
                  {locked ? "依赖锁定" : isActive ? "已启用" : "启用技能"}
                </button>
              </article>
            );
          })}
        </div>

        <footer className="skill-store-footer">
          <span>
            本轮将加载 <strong>{activeIds.length}</strong> 个技能
          </span>
          <button type="button" className="skill-store-done" onClick={() => setOpen(false)}>
            完成
          </button>
        </footer>
      </div>
    </div>
  ) : null;

  return (
    <div className="skill-picker">
      <button
        type="button"
        className="skill-picker-trigger"
        aria-controls={dialogId}
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        技能商店 <strong>{activeIds.length}</strong>
      </button>

      <div className="skill-picker-active" aria-label="本轮已加载技能">
        {activeIds.length ? (
          activeIds.map((id) => (
            <span key={id}>
              {byId.get(id)?.title ?? id}
              {(requiredBy[id]?.length ?? 0) > 0 ? <i aria-label="依赖锁定">锁定</i> : null}
            </span>
          ))
        ) : (
          <span className="is-empty">未加载技能</span>
        )}
      </div>

      {dialog ? createPortal(dialog, document.body) : null}
    </div>
  );
}
