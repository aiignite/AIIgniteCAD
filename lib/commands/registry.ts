/**
 * commands/registry.ts — 命令注册表
 *
 * 统一负责别名解析、参数映射、帮助文本、Tab 补全与执行分发。
 * App.tsx 只调用 executeCommand，新增命令只需在 builtins 中声明。
 */

import { BUILTIN_COMMANDS } from "./builtins";
import type {
    CommandArg,
    CommandContext,
    CommandDefinition,
    CommandOutcome,
    ResolvedCommand,
} from "./types";

const HELP_COMMAND: CommandDefinition = {
    name: "HELP",
    aliases: ["?"],
    description: "List commands, or show usage for one command",
    args: [
        {
            name: "command",
            description: "Command name or alias to describe",
            type: "string",
        },
    ],
    run: (_ctx, values) => {
        const target = values.command?.trim();
        if (!target) {
            return { message: `Commands: ${COMMANDS.map((definition) => definition.name).join(", ")}` };
        }

        const definition = findCommand(target);
        if (!definition) {
            return { message: `Unknown command: ${target.toUpperCase()}`, error: true };
        }
        return { message: `${getUsage(definition)} — ${definition.description}` };
    },
};

export const COMMANDS: readonly CommandDefinition[] = [...BUILTIN_COMMANDS, HELP_COMMAND];

const COMMAND_INDEX = new Map<string, CommandDefinition>();
COMMANDS.forEach((definition) => {
    COMMAND_INDEX.set(definition.name, definition);
    definition.aliases.forEach((alias) => COMMAND_INDEX.set(alias, definition));
});

/** 按规范名或别名查找命令（大小写不敏感） */
export function findCommand(token: string): CommandDefinition | undefined {
    return COMMAND_INDEX.get(token.trim().toUpperCase());
}

/** 生成用法文本：必填用 <>，可选与默认值用 [] */
export function getUsage(definition: CommandDefinition): string {
    const parts = (definition.args ?? []).map((arg) => {
        const label = arg.defaultValue !== undefined ? `${arg.name}=${arg.defaultValue}` : arg.name;
        return arg.required ? `<${label}>` : `[${label}]`;
    });
    return [definition.name, ...parts].join(" ");
}

/** 返回尚未提供且无默认值的必填参数 */
export function getMissingArgs(definition: CommandDefinition, provided: string[]): CommandArg[] {
    return (definition.args ?? []).filter(
        (arg, index) =>
            provided[index] === undefined &&
            arg.defaultValue === undefined &&
            arg.required === true,
    );
}

/** 解析命令行：命令名 + 位置参数，未知命令返回 definition=null */
export function resolveCommandInput(input: string): ResolvedCommand | null {
    const tokens = input.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return null;

    const definition = findCommand(tokens[0]) ?? null;
    const provided = tokens.slice(1);
    const values: Record<string, string> = {};

    definition?.args?.forEach((arg, index) => {
        const raw = provided[index];
        if (raw !== undefined) values[arg.name] = raw;
        else if (arg.defaultValue !== undefined) values[arg.name] = arg.defaultValue;
    });

    return {
        definition,
        provided,
        values,
        missing: definition ? getMissingArgs(definition, provided) : [],
        raw: input.trim(),
    };
}

/** 执行命令行；参数缺失时返回用法而不是运行命令 */
export function executeCommand(input: string, ctx: CommandContext): CommandOutcome {
    const resolved = resolveCommandInput(input);
    if (!resolved) return {};

    if (!resolved.definition) {
        return { message: `Unknown command: ${resolved.raw.toUpperCase()}`, error: true };
    }

    if (resolved.missing.length > 0) {
        return { message: `Usage: ${getUsage(resolved.definition)}`, error: true };
    }

    return resolved.definition.run(ctx, resolved.values);
}

/** Tab 补全候选：按规范名或别名前缀匹配，空前缀返回全部命令 */
export function completeCommand(prefix: string): CommandDefinition[] {
    const token = prefix.trim().toUpperCase();
    return COMMANDS
        .filter(
            (definition) =>
                token === "" ||
                definition.name.startsWith(token) ||
                definition.aliases.some((alias) => alias.startsWith(token)),
        )
        .sort((a, b) => a.name.localeCompare(b.name));
}

/** 分步输入提示：当前需要填写的参数 */
export function formatArgPrompt(arg: CommandArg): string {
    return `${arg.name} (${arg.type}) — ${arg.description}`;
}
