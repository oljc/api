import { createHash, randomBytes } from "node:crypto";

/** 生成 URL-safe 随机 token（明文仅返回一次） */
export function generateToken(bytes = 32): string {
	return randomBytes(bytes).toString("base64url");
}

/** SHA-256 hex，用于入库存储 */
export function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}
