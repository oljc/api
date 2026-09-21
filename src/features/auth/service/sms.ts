import { AppError } from "@/lib/errors";
import { parseMobile } from "../internal/identity";
import type { SmsLoginInput } from "../schema";

const SMS_NOT_READY = "短信登录暂未开放";
const EXPIRE_SECONDS = 300;

/** 本期仅校验手机号并预留响应形状，不发短信。 */
export const sendSms = async (
	mobile: string,
): Promise<{ expireSeconds: number }> => {
	parseMobile(mobile);
	throw new AppError(501, SMS_NOT_READY, {
		data: { expireSeconds: EXPIRE_SECONDS },
	});
};

/** 本期仅校验为手机号，不核销验证码、不建会话。 */
export const loginWithSms = async (_input: SmsLoginInput): Promise<never> => {
	parseMobile(_input.account);
	throw new AppError(501, SMS_NOT_READY, {
		data: { expireSeconds: EXPIRE_SECONDS },
	});
};
