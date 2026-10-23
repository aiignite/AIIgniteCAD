import React, { useState } from "react";
import type { AiSkill } from "../../types";

interface SkillPinMenuProps {
    skills: AiSkill[];
    pinned: string[];
    onChange: (codes: string[]) => void;
}

/** 手动把技能钉到本轮 prompt 上，绕过规则评分（例如临时强制"齿轮画法"） */
const SkillPinMenu: React.FC<SkillPinMenuProps> = ({ skills, pinned, onChange }) => {
    const [open, setOpen] = useState(false);
    const enabled = skills.filter((skill) => skill.isEnabled);

    const toggle = (code: string) => {
        onChange(
            pinned.includes(code) ? pinned.filter((item) => item !== code) : [...pinned, code],
        );
    };

    return (
        <div className="relative shrink-0">
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    setOpen((prev) => !prev);
                }}
                className={`p-1.5 rounded-md transition-colors ${
                    pinned.length > 0
                        ? "text-cad-primary bg-cad-primary/10"
                        : "text-cad-muted hover:text-cad-text hover:bg-cad-text/10"
                }`}
                title={`固定技能${pinned.length ? `（已固定 ${pinned.length}）` : ""}`}
            >
                <span className="material-symbols-outlined text-[18px]">pin</span>
            </button>

            {open && (
                <>
                    <div
                        className="fixed inset-0 z-40"
                        onClick={() => setOpen(false)}
                        aria-hidden
                    />
                    <div className="absolute right-0 top-9 z-50 w-60 max-h-72 overflow-y-auto rounded-lg border border-cad-border bg-cad-panel shadow-xl">
                        <p className="px-2 py-1.5 text-[10px] text-cad-muted border-b border-cad-border">
                            固定后本轮必定注入该技能提示词
                        </p>
                        {enabled.length === 0 && (
                            <p className="p-3 text-[11px] text-cad-muted">
                                没有启用的技能，可在技能面板新建
                            </p>
                        )}
                        {enabled.map((skill) => (
                            <label
                                key={skill.code}
                                className="flex items-start gap-2 px-2 py-1.5 text-[11px] hover:bg-cad-text/5 cursor-pointer"
                                title={skill.description}
                            >
                                <input
                                    type="checkbox"
                                    checked={pinned.includes(skill.code)}
                                    onChange={() => toggle(skill.code)}
                                    className="mt-0.5 accent-[#137fec]"
                                />
                                <span className="min-w-0">
                                    <span className="block truncate text-cad-text">
                                        {skill.name}
                                    </span>
                                    <span className="block text-[10px] text-cad-muted">
                                        {skill.category} · 优先级 {skill.priority}
                                    </span>
                                </span>
                            </label>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

export default SkillPinMenu;
