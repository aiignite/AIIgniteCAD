import React from "react";
import type { SkillActivationEvent } from "../../lib/aiSseEvents";

interface SkillActivationChipsProps {
    skills: SkillActivationEvent[];
}

/** 把规则路由命中的技能显示出来，让用户知道这轮 prompt 被谁改写过 */
const SkillActivationChips: React.FC<SkillActivationChipsProps> = ({ skills }) => {
    if (skills.length === 0) return null;

    return (
        <div className="flex flex-wrap gap-1.5">
            {skills.map((skill) => (
                <span
                    key={skill.code}
                    title={`${skill.name} · 评分 ${skill.score.toFixed(2)} · ${skill.reasons.join("；")}`}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-cad-primary/30 bg-cad-primary/10 text-[10px] text-cad-primary"
                >
                    <span className="material-symbols-outlined text-[12px]">extension</span>
                    {skill.name}
                </span>
            ))}
        </div>
    );
};

export default SkillActivationChips;
