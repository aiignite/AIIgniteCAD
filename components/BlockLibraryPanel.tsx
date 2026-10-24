/**
 * BlockLibraryPanel.tsx — 图块库
 *
 * 内容插入类面板，放在左侧工具面板（与绘图工具相邻）；
 * 图块 / 分类树支持拖入画布，建块取自当前选择集。
 */

import React, { useEffect, useState } from "react";
import type { BlockCategory, BlockDefinition, CADElement } from "../types";
import { getBlockTree, createCategory, createBlock, moveItem } from "../services/blockService";
import { useCanvas } from "../store/canvasStore";
import { useApp } from "../store/appStore";
import PromptDialog from "./PromptDialog";
import { useI18n } from "../lib/i18n";

interface BlockLibraryPanelProps {
    /** 当前图元：建块时从选择集取内容 */
    currentElements: CADElement[];
}

export const BlockLibraryPanel: React.FC<BlockLibraryPanelProps> = ({ currentElements }) => {
    const { t } = useI18n();
    const { selectedIds } = useCanvas();
    const { showNotification } = useApp();

    const [blockTree, setBlockTree] = useState<{
        categories: BlockCategory[];
        rootBlocks: BlockDefinition[];
    }>({ categories: [], rootBlocks: [] });
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
    const [blockSearch, setBlockSearch] = useState("");
    const [draggedBlockItem, setDraggedBlockItem] = useState<{
        type: "block" | "category";
        id: string;
    } | null>(null);
    const [pendingPrompt, setPendingPrompt] = useState<"blockName" | "categoryName" | null>(null);

    useEffect(() => {
        let cancelled = false;
        getBlockTree(undefined)
            .then((data) => {
                if (!cancelled) setBlockTree(data);
            })
            .catch((e) => console.error("Failed to load blocks", e));
        return () => {
            cancelled = true;
        };
    }, []);

    const loadBlockData = async () => {
        try {
            const data = await getBlockTree(undefined);
            setBlockTree(data);
        } catch (e) {
            console.error("Failed to load blocks", e);
        }
    };

    /** 选中图元的形心作为块基点，取不到几何时退回原点 */
    const computeBasePoint = (selected: CADElement[]) => {
        let x = 0,
            y = 0,
            count = 0;
        selected.forEach((e) => {
            if (e.start) {
                x += e.start.x;
                y += e.start.y;
                count++;
            } else if (e.end) {
                x += e.end.x;
                y += e.end.y;
                count++;
            } else if (e.center) {
                x += e.center.x;
                y += e.center.y;
                count++;
            }
        });
        return count > 0 ? { x: x / count, y: y / count } : { x: 0, y: 0 };
    };

    const handleCreateBlock = () => {
        const selected = currentElements.filter((e) => selectedIds.has(e.id));
        if (selected.length === 0) {
            showNotification(t("block.needSelection"));
            return;
        }
        setPendingPrompt("blockName");
    };

    const submitBlockName = async (name: string) => {
        setPendingPrompt(null);
        const selected = currentElements.filter((e) => selectedIds.has(e.id));
        if (!name || selected.length === 0) return;

        try {
            await createBlock(name, selected, computeBasePoint(selected), undefined, undefined, undefined);
            await loadBlockData();
            showNotification(t("notify.blockSaved", { count: selected.length, name }));
        } catch (e) {
            showNotification(
                t("notify.blockSaveFailed", { message: e instanceof Error ? e.message : String(e) }),
            );
        }
    };

    const handleCreateCategory = () => {
        setPendingPrompt("categoryName");
    };

    const submitCategoryName = async (name: string) => {
        setPendingPrompt(null);
        if (!name) return;
        try {
            await createCategory(name, undefined, undefined);
            await loadBlockData();
        } catch (e) {
            console.error(e);
        }
    };

    const handleBlockDrop = async (targetId: string | null) => {
        if (!draggedBlockItem) return;
        if (draggedBlockItem.id === targetId) return;
        try {
            await moveItem(draggedBlockItem.type, draggedBlockItem.id, targetId || undefined);
            await loadBlockData();
        } catch (e) {
            console.error(e);
        }
        setDraggedBlockItem(null);
    };

    const getFilteredTree = () => {
        if (!blockSearch) return blockTree;

        const lower = blockSearch.toLowerCase();

        const filterCat = (cat: BlockCategory): BlockCategory | null => {
            const matchingBlocks =
                cat.blocks?.filter((b) => b.name.toLowerCase().includes(lower)) || [];
            const matchingChildren =
                (cat.children
                    ?.map((c) => filterCat(c))
                    .filter((c) => c !== null) as BlockCategory[]) || [];

            if (
                cat.name.toLowerCase().includes(lower) ||
                matchingBlocks.length > 0 ||
                matchingChildren.length > 0
            ) {
                return {
                    ...cat,
                    blocks: matchingBlocks,
                    children: matchingChildren,
                };
            }
            return null;
        };

        return {
            categories: blockTree.categories
                .map((c) => filterCat(c))
                .filter((c) => c !== null) as BlockCategory[],
            rootBlocks: blockTree.rootBlocks.filter((b) => b.name.toLowerCase().includes(lower)),
        };
    };

    const filteredTree = getFilteredTree();

    const renderBlockNode = (block: BlockDefinition) => (
        <div
            key={block.id}
            draggable
            onDragStart={(e) => {
                setDraggedBlockItem({ type: "block", id: block.id });
                e.dataTransfer.setData("blockId", block.id); // For Canvas Drop
                e.dataTransfer.effectAllowed = "copy";
            }}
            className="flex items-center p-1.5 hover:bg-cad-hover/10 cursor-pointer text-xs rounded"
        >
            <span className="material-symbols-outlined text-[16px] mr-2 text-cad-primary">
                deployed_code
            </span>
            <span className="truncate">{block.name}</span>
        </div>
    );

    const renderCategoryNode = (category: BlockCategory) => {
        const isExpanded = expandedCategories.has(category.id) || blockSearch.length > 0;
        return (
            <div key={category.id} className="ml-2">
                <div
                    className={`flex items-center p-1.5 hover:bg-cad-hover/10 cursor-pointer text-xs rounded ${draggedBlockItem?.id === category.id ? "opacity-50" : ""}`}
                    draggable
                    onDragStart={(e) => {
                        e.stopPropagation();
                        setDraggedBlockItem({ type: "category", id: category.id });
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleBlockDrop(category.id);
                    }}
                    onClick={() => {
                        const newSet = new Set(expandedCategories);
                        if (isExpanded) newSet.delete(category.id);
                        else newSet.add(category.id);
                        setExpandedCategories(newSet);
                    }}
                >
                    <span className="material-symbols-outlined text-[16px] mr-2 text-amber-500 dark:text-amber-400">
                        {isExpanded ? "folder_open" : "folder"}
                    </span>
                    <span className="truncate">{category.name}</span>
                </div>
                {isExpanded && (
                    <div className="ml-3 border-l border-cad-border pl-1">
                        {category.children?.map(renderCategoryNode)}
                        {category.blocks?.map(renderBlockNode)}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="flex flex-col gap-2 px-1.5 pb-2" data-testid="block-library">
            <div className="flex gap-1.5">
                <button
                    onClick={handleCreateBlock}
                    className="flex-1 bg-cad-primary text-white text-[11px] py-1.5 px-2 rounded flex items-center justify-center gap-1 hover:bg-cad-primaryHover"
                    title={t("block.createTitle")}
                >
                    <span className="material-symbols-outlined text-[14px]">add_box</span>
                    {t("block.create")}
                </button>
                <button
                    onClick={handleCreateCategory}
                    className="flex-1 bg-cad-secondary text-cad-text text-[11px] py-1.5 px-2 rounded flex items-center justify-center gap-1 hover:bg-cad-text/10"
                    title={t("category.createTitle")}
                >
                    <span className="material-symbols-outlined text-[14px]">
                        create_new_folder
                    </span>
                    {t("category.create")}
                </button>
            </div>

            <input
                type="text"
                placeholder={t("panel.searchBlocks")}
                className="w-full bg-cad-bg border border-cad-border rounded p-1.5 text-xs text-cad-text outline-none focus:border-cad-primary"
                value={blockSearch}
                onChange={(e) => setBlockSearch(e.target.value)}
            />

            <div
                className="max-h-64 overflow-y-auto -mx-1 px-1"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                    e.preventDefault();
                    handleBlockDrop(null);
                }}
            >
                {filteredTree.categories.map(renderCategoryNode)}
                {filteredTree.rootBlocks.map(renderBlockNode)}

                {filteredTree.categories.length === 0 && filteredTree.rootBlocks.length === 0 && (
                    <p className="text-cad-muted text-xs text-center mt-4">{t("panel.noBlocks")}</p>
                )}
            </div>

            {/* 建块 / 建分类命名弹窗 */}
            {pendingPrompt === "blockName" && (
                <PromptDialog
                    title={t("block.nameTitle")}
                    placeholder={t("block.namePlaceholder")}
                    confirmLabel={t("common.create")}
                    cancelLabel={t("common.cancel")}
                    onConfirm={submitBlockName}
                    onCancel={() => setPendingPrompt(null)}
                />
            )}
            {pendingPrompt === "categoryName" && (
                <PromptDialog
                    title={t("category.nameTitle")}
                    placeholder={t("category.namePlaceholder")}
                    confirmLabel={t("common.create")}
                    cancelLabel={t("common.cancel")}
                    onConfirm={submitCategoryName}
                    onCancel={() => setPendingPrompt(null)}
                />
            )}
        </div>
    );
};

export default BlockLibraryPanel;
