/**
 * crypto.ts — 敏感字段加解密工具
 *
 * 采用 AES-256-GCM 对 LLM API Key 等敏感字段做静态加密：
 *   - 密文格式：`enc:v1:<iv>:<authTag>:<ciphertext>`（均为 Base64URL 编码）
 *   - 密钥来源：环境变量 ENCRYPTION_KEY（32 字节，支持 64 位 hex / Base64 / 32 字符原文）
 *   - 兼容历史数据：不带 `enc:v1:` 前缀的值视为明文直接返回，便于平滑迁移
 */

import crypto from "crypto";

/** 密文前缀，用于区分加密数据与历史明文数据 */
const CIPHER_PREFIX = "enc:v1:";

/** AES-GCM 初始化向量长度（字节） */
const IV_LENGTH = 12;

/**
 * 读取并规范化加密密钥
 * 支持三种写法：64 位 hex、Base64、32 位原始字符
 * @returns 32 字节密钥 Buffer
 * @throws 当 ENCRYPTION_KEY 缺失或长度不合法时抛出
 */
function getEncryptionKey(): Buffer {
    const raw = process.env.ENCRYPTION_KEY?.trim();
    if (!raw) {
        throw new Error(
            "ENCRYPTION_KEY 未配置：请在环境变量中提供 32 字节密钥（生成方式：openssl rand -hex 32）",
        );
    }

    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
        return Buffer.from(raw, "hex");
    }

    const base64Key = Buffer.from(raw, "base64");
    if (base64Key.length === 32) {
        return base64Key;
    }

    if (Buffer.byteLength(raw, "utf8") === 32) {
        return Buffer.from(raw, "utf8");
    }

    throw new Error("ENCRYPTION_KEY 长度不合法：需为 64 位 hex、Base64 或 32 字符原文");
}

/**
 * 判断字符串是否为本模块产生的密文
 * @param value 待判断的字符串
 * @returns 是否为密文
 */
export function isEncrypted(value: string): boolean {
    return value.startsWith(CIPHER_PREFIX);
}

/**
 * 加密敏感明文
 * @param plain 明文内容
 * @returns 形如 `enc:v1:...` 的密文
 */
export function encryptSecret(plain: string): string {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [
        `${CIPHER_PREFIX}${iv.toString("base64url")}`,
        authTag.toString("base64url"),
        ciphertext.toString("base64url"),
    ].join(":");
}

/**
 * 解密敏感字段，自动兼容历史明文
 * @param stored 数据库中的存储值
 * @returns 明文；空值原样返回
 * @throws 密文被篡改或密钥不匹配时抛出
 */
export function decryptSecret(stored: string | null | undefined): string {
    if (!stored) return "";
    if (!isEncrypted(stored)) return stored; // 历史明文，原样返回

    const parts = stored.slice(CIPHER_PREFIX.length).split(":");
    if (parts.length !== 3) {
        throw new Error("密文格式不合法");
    }

    const [ivB64, tagB64, dataB64] = parts;
    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));

    return Buffer.concat([
        decipher.update(Buffer.from(dataB64, "base64url")),
        decipher.final(),
    ]).toString("utf8");
}

/**
 * 对密钥类字符串做脱敏，供日志与接口返回使用
 * @param secret 原始密钥
 * @returns 形如 `sk-a****9f2c` 的脱敏串；空值返回空串
 */
export function maskSecret(secret: string | null | undefined): string {
    if (!secret) return "";
    if (secret.length <= 8) return "****";
    return `${secret.slice(0, 4)}****${secret.slice(-4)}`;
}
