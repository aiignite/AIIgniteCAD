/**
 * command.ts — Command 模式实现
 * 提供 Undo/Redo 的支持，替代快照式历史管理
 */

import { CADElement, Point } from "../types";

/* ─── Command 接口 ─────────────────────────────────────────── */

export interface Command {
  /** 命令类型标识 */
  readonly type: string;
  /** 执行命令 */
  execute(): void;
  /** 撤销命令 */
  undo(): void;
  /** 重做命令 */
  redo(): void;
}

/* ─── Command 历史管理器 ──────────────────────────────────── */

export interface CommandHistoryOptions {
  maxHistory?: number;
  onStateChange?: () => void;
}

export class CommandHistory {
  private commands: Command[] = [];
  private index = -1;
  private maxHistory: number;
  private onStateChange?: () => void;

  constructor(options?: CommandHistoryOptions) {
    this.maxHistory = options?.maxHistory ?? 100;
    this.onStateChange = options?.onStateChange;
  }

  /** 执行一个命令并加入历史 */
  execute(command: Command): void {
    this.commands = this.commands.slice(0, this.index + 1);
    this.commands.push(command);
    if (this.commands.length > this.maxHistory) {
      this.commands.shift();
    }
    this.index = this.commands.length - 1;
    command.execute();
    this.onStateChange?.();
  }

  /** 撤销 */
  undo(): boolean {
    if (this.index < 0 || this.index >= this.commands.length) return false;
    this.commands[this.index].undo();
    this.index--;
    this.onStateChange?.();
    return true;
  }

  /** 重做 */
  redo(): boolean {
    if (this.index >= this.commands.length - 1) return false;
    this.index++;
    this.commands[this.index].redo();
    this.onStateChange?.();
    return true;
  }

  get canUndo(): boolean {
    return this.index >= 0;
  }

  get canRedo(): boolean {
    return this.index < this.commands.length - 1;
  }

  get size(): number {
    return this.commands.length;
  }

  clear(): void {
    this.commands = [];
    this.index = -1;
  }
}

/* ─── 抽象基类 ─────────────────────────────────────────────── */

export abstract class BaseCommand implements Command {
  abstract readonly type: string;
  protected elements: CADElement[];
  protected previousElements: CADElement[];

  constructor(elements: CADElement[], previousElements: CADElement[]) {
    this.elements = elements;
    this.previousElements = previousElements;
  }

  abstract execute(): void;
  abstract undo(): void;
  abstract redo(): void;
}

/* ─── 具体命令实现 ────────────────────────────────────────── */

/** 添加元素命令 */
export class AddElementCommand implements Command {
  readonly type = "ADD_ELEMENT";
  private currentElements: CADElement[];
  private newElement: CADElement;
  private setElements: (elements: CADElement[]) => void;

  constructor(
    currentElements: CADElement[],
    newElement: CADElement,
    setElements: (elements: CADElement[]) => void
  ) {
    this.currentElements = [...currentElements];
    this.newElement = newElement;
    this.setElements = setElements;
  }

  execute(): void {
    this.setElements([...this.currentElements, this.newElement]);
  }

  undo(): void {
    this.setElements(this.currentElements);
  }

  redo(): void {
    this.execute();
  }
}

/** 删除元素命令 */
export class DeleteElementCommand implements Command {
  readonly type = "DELETE_ELEMENT";
  private currentElements: CADElement[];
  private removedElement: CADElement;
  private index: number;
  private setElements: (elements: CADElement[]) => void;

  constructor(
    currentElements: CADElement[],
    removedElement: CADElement,
    setElements: (elements: CADElement[]) => void
  ) {
    this.currentElements = currentElements;
    this.removedElement = removedElement;
    this.index = currentElements.findIndex((e) => e.id === removedElement.id);
    this.setElements = setElements;
  }

  execute(): void {
    const newEls = this.currentElements.filter((e) => e.id !== this.removedElement.id);
    this.setElements(newEls);
  }

  undo(): void {
    const newEls = [...this.currentElements];
    newEls.splice(this.index, 0, this.removedElement);
    this.setElements(newEls);
  }

  redo(): void {
    this.execute();
  }
}

/** 批量更新元素命令 */
export class BulkUpdateCommand implements Command {
  readonly type = "BULK_UPDATE";
  private originalElements: CADElement[];
  private updatedElements: CADElement[];
  private setElements: (elements: CADElement[]) => void;

  constructor(
    originalElements: CADElement[],
    updatedElements: CADElement[],
    setElements: (elements: CADElement[]) => void
  ) {
    this.originalElements = originalElements;
    this.updatedElements = updatedElements;
    this.setElements = setElements;
  }

  execute(): void {
    this.setElements(this.updatedElements);
  }

  undo(): void {
    this.setElements(this.originalElements);
  }

  redo(): void {
    this.setElements(this.updatedElements);
  }
}

/** 移动元素命令（支持合并连续移动） */
export class MoveElementsCommand implements Command {
  readonly type = "MOVE_ELEMENTS";
  private elementsBefore: CADElement[];
  private elementsAfter: CADElement[];
  private setElements: (elements: CADElement[]) => void;
  private merged: boolean = false;

  constructor(
    elementsBefore: CADElement[],
    elementsAfter: CADElement[],
    setElements: (elements: CADElement[]) => void
  ) {
    this.elementsBefore = elementsBefore;
    this.elementsAfter = elementsAfter;
    this.setElements = setElements;
  }

  execute(): void {
    this.setElements(this.elementsAfter);
  }

  undo(): void {
    this.setElements(this.elementsBefore);
  }

  redo(): void {
    this.setElements(this.elementsAfter);
  }

  /** 合并连续的移动操作 */
  tryMerge(other: MoveElementsCommand): boolean {
    if (this.merged) return false;
    this.elementsAfter = other.elementsAfter;
    this.merged = true;
    return true;
  }
}
