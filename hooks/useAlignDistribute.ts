/**
 * useAlignDistribute.ts — 对齐 / 分布的统一执行入口
 *
 * 右键菜单、选中集迷你工具栏与属性面板共用这一份实现，
 * 全部走 commitAction 单步撤销；数量不足时给出提示。
 */

import { useCallback } from "react";
import { useCanvas } from "../store/canvasStore";
import { useApp } from "../store/appStore";
import {
    alignElements,
    distributeElements,
    type AlignMode,
    type DistributeAxis,
} from "../lib/designOps";
import { useI18n, type TranslationKey } from "../lib/i18n";

/** 对齐/分布菜单项：右键菜单外的迷你工具栏与属性面板共用（分布共用图标，垂直旋转 90°） */
export const ALIGN_MENU_ITEMS: ReadonlyArray<{
    icon: string;
    labelKey: TranslationKey;
    rotate?: boolean;
    align?: AlignMode;
    distribute?: DistributeAxis;
}> = [
    { icon: "align_horizontal_left", labelKey: "context.alignLeft", align: "left" },
    { icon: "align_horizontal_center", labelKey: "context.alignCenterX", align: "centerX" },
    { icon: "align_horizontal_right", labelKey: "context.alignRight", align: "right" },
    { icon: "align_vertical_top", labelKey: "context.alignTop", align: "top" },
    { icon: "align_vertical_center", labelKey: "context.alignCenterY", align: "centerY" },
    { icon: "align_vertical_bottom", labelKey: "context.alignBottom", align: "bottom" },
    {
        icon: "align_justify_space_between",
        labelKey: "context.distributeH",
        distribute: "horizontal",
    },
    {
        icon: "align_justify_space_between",
        labelKey: "context.distributeV",
        distribute: "vertical",
        rotate: true,
    },
];

export interface AlignDistributeApi {
    applyAlign: (mode: AlignMode) => void;
    applyDistribute: (axis: DistributeAxis) => void;
    /** 对齐至少需要 2 个图元 */
    canAlign: boolean;
    /** 分布至少需要 3 个图元 */
    canDistribute: boolean;
}

export function useAlignDistribute(): AlignDistributeApi {
    const { state, selectedIds, commitAction } = useCanvas();
    const { showNotification } = useApp();
    const { t } = useI18n();

    const applyAlign = useCallback(
        (mode: AlignMode) => {
            const targets = state.elements.filter((element) => selectedIds.has(element.id));
            const outcome = alignElements(state.elements, targets, mode);
            if (!outcome) {
                showNotification(t("notify.alignNeedMore"));
                return;
            }
            commitAction(outcome.elements);
            showNotification(t("notify.aligned"));
        },
        [commitAction, selectedIds, showNotification, state.elements, t],
    );

    const applyDistribute = useCallback(
        (axis: DistributeAxis) => {
            const targets = state.elements.filter((element) => selectedIds.has(element.id));
            const outcome = distributeElements(state.elements, targets, axis);
            if (!outcome) {
                showNotification(t("notify.distributeNeedMore"));
                return;
            }
            commitAction(outcome.elements);
            showNotification(t("notify.distributed"));
        },
        [commitAction, selectedIds, showNotification, state.elements, t],
    );

    return {
        applyAlign,
        applyDistribute,
        canAlign: selectedIds.size >= 2,
        canDistribute: selectedIds.size >= 3,
    };
}
