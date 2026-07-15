import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { SkillId, SkillSummary } from "../lib/ai/skills/registry";

type SkillPickerProps = {
  skills: SkillSummary[];
  requestedIds: readonly SkillId[];
  activeIds: readonly SkillId[];
  requiredBy: Readonly<Record<SkillId, SkillId[]>>;
  disabled?: boolean;
  onChange: (ids: SkillId[]) => void;
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

export function SkillPicker({
  skills,
  requestedIds,
  activeIds,
  requiredBy,
  disabled = false,
  onChange,
}: SkillPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const active = useMemo(() => new Set(activeIds), [activeIds]);
  const byId = useMemo(() => new Map(skills.map((skill) => [skill.id, skill])), [skills]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function toggle(id: SkillId, checked: boolean) {
    onChange(updateRequestedSkillIds(skills, requestedIds, id, checked));
  }

  return (
    <div className="skill-picker" ref={rootRef}>
      <button
        type="button"
        className="skill-picker-trigger"
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        技能 <strong>{activeIds.length}</strong>
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

      {open ? (
        <div className="skill-picker-menu" id={menuId} role="group" aria-label="选择 Agent 技能">
          <header>
            <strong>加载技能</strong>
            <small>仅已加载技能会注册对应 CLI</small>
          </header>
          {skills.map((skill) => {
            const dependents = requiredBy[skill.id] ?? [];
            const locked = isSkillDependencyLocked(requiredBy, skill.id);
            const dependencyLabels = dependents.map((id) => byId.get(id)?.title ?? id);
            return (
              <label className={`skill-picker-option ${locked ? "is-locked" : ""}`} key={skill.id}>
                <input
                  type="checkbox"
                  checked={active.has(skill.id)}
                  disabled={disabled || locked}
                  onChange={(event) => toggle(skill.id, event.target.checked)}
                />
                <span>
                  <strong>{skill.title}</strong>
                  <small>{skill.description}</small>
                  {locked ? <em>由 {dependencyLabels.join("、")} 自动加载</em> : null}
                  {!locked && skill.requires.length ? (
                    <em>
                      同时加载{" "}
                      {skill.requires.map((id) => byId.get(id)?.title ?? id).join("、")}
                    </em>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
