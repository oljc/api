import { AppError } from "@/lib/errors";

export type IdentityType = "email" | "mobile";

export type ParsedIdentity = {
	type: IdentityType;
	key: string;
};

const normalizeMobile = (raw: string): string => {
	let digits = raw.replace(/[\s-]/g, "");
	if (digits.startsWith("+86")) {
		digits = digits.slice(3);
	} else if (digits.startsWith("86") && digits.length === 13) {
		digits = digits.slice(2);
	}
	return digits;
};

/** 从用户输入识别登录身份；type 只在服务端使用。 */
export const parseAccount = (raw: string): ParsedIdentity => {
	const trimmed = raw.trim();
	if (!trimmed) {
		throw new AppError(400, "请输入邮箱或手机号");
	}

	if (trimmed.includes("@")) {
		const key = trimmed.toLowerCase();
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key) || key.length > 255) {
			throw new AppError(400, "请输入邮箱或手机号");
		}
		return { type: "email", key };
	}

	const key = normalizeMobile(trimmed);
	if (!/^1[3-9]\d{9}$/.test(key)) {
		throw new AppError(400, "请输入邮箱或手机号");
	}
	return { type: "mobile", key };
};

/** 短信场景：必须是手机号。 */
export const parseMobile = (raw: string): string => {
	const identity = parseAccount(raw);
	if (identity.type !== "mobile") {
		throw new AppError(400, "验证码登录仅支持手机号");
	}
	return identity.key;
};
