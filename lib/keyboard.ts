/**
 * keyboard.ts — 键盘事件辅助
 *
 * 全局快捷键必须避开输入控件，否则在命令栏或聊天框中
 * Ctrl+Z / Delete / Enter 会误触发画布操作。
 */

export function isEditableTarget(target: EventTarget | null): boolean {
    if (!target || typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) {
        return false;
    }
    if (target.isContentEditable) return true;
    return target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT";
}
