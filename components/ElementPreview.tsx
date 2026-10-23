/**
 * ElementPreview.tsx — 只读图元预览
 *
 * 自动按图元包围盒计算 viewBox，供版本历史与 AI 变更预览共用。
 */

import React, { useMemo } from "react";
import type { CADElement } from "../types";
import { getElementBoundingBox } from "../lib/geometry";
import CADElementRenderer from "./CADElementRenderer";

interface ElementPreviewProps {
    elements: CADElement[];
    dimScale?: number;
    dimPrecision?: number;
    ariaLabel?: string;
    className?: string;
}

export const ElementPreview: React.FC<ElementPreviewProps> = ({
    elements,
    dimScale = 1,
    dimPrecision = 2,
    ariaLabel = "Drawing preview",
    className = "w-full h-64 rounded-lg border border-cad-border bg-[#0b1220]",
}) => {
    const viewBox = useMemo(() => {
        if (elements.length === 0) return "-50 -50 100 100";

        const box = elements.reduce(
            (acc, element) => {
                const next = getElementBoundingBox(element);
                return {
                    minX: Math.min(acc.minX, next.minX),
                    minY: Math.min(acc.minY, next.minY),
                    maxX: Math.max(acc.maxX, next.maxX),
                    maxY: Math.max(acc.maxY, next.maxY),
                };
            },
            { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
        );
        const width = Math.max(box.maxX - box.minX, 1);
        const height = Math.max(box.maxY - box.minY, 1);
        const pad = Math.max(width, height) * 0.08;
        return `${box.minX - pad} ${box.minY - pad} ${width + pad * 2} ${height + pad * 2}`;
    }, [elements]);

    return (
        <svg viewBox={viewBox} className={className} role="img" aria-label={ariaLabel}>
            {elements.map((element) => (
                <CADElementRenderer
                    key={element.id}
                    element={element}
                    isSelected={false}
                    dimScale={dimScale}
                    dimPrecision={dimPrecision}
                />
            ))}
        </svg>
    );
};

export default ElementPreview;
