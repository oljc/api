import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "@/types/api";

const ACCESS_COOKIE = "access";
const REFRESH_COOKIE = "refresh";
const ACCESS_PATH = "/";
const REFRESH_PATH = "/auth";

/** 与 session.expire_time / refresh_expire_time 对齐 */
export const ACCESS_MAX_AGE = 2 * 60 * 60;
export const REFRESH_MAX_AGE = 30 * 24 * 60 * 60;

type CookieContext = Context<AppEnv>;

const requestHostname = (c: CookieContext): string => {
	try {
		return new URL(c.req.url).hostname;
	} catch {
		return "";
	}
};

/** `__Host-` 在 IP 主机上可能被浏览器拒绝，仅开发回退到无前缀 */
const supportsHostPrefix = (hostname: string): boolean => {
	if (!hostname) return false;
	if (hostname.startsWith("[") && hostname.endsWith("]")) return false;
	if (hostname.includes(":")) return false;
	return !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
};

const firstNonEmpty = (
	...values: Array<string | undefined>
): string | undefined => {
	return values.find((value) => value && value.length > 0);
};

export const getAccessToken = (c: CookieContext): string | undefined => {
	return firstNonEmpty(
		getCookie(c, ACCESS_COOKIE, "host"),
		getCookie(c, ACCESS_COOKIE),
	);
};

export const getRefreshToken = (c: CookieContext): string | undefined => {
	return firstNonEmpty(
		getCookie(c, REFRESH_COOKIE, "secure"),
		getCookie(c, REFRESH_COOKIE),
	);
};

export const setAuthCookies = (
	c: CookieContext,
	tokens: { accessToken: string; refreshToken: string },
): void => {
	const useHostPrefix = supportsHostPrefix(requestHostname(c));

	setCookie(c, ACCESS_COOKIE, tokens.accessToken, {
		path: ACCESS_PATH,
		httpOnly: true,
		secure: true,
		sameSite: "Lax",
		maxAge: ACCESS_MAX_AGE,
		...(useHostPrefix ? { prefix: "host" as const } : {}),
	});

	setCookie(c, REFRESH_COOKIE, tokens.refreshToken, {
		path: REFRESH_PATH,
		httpOnly: true,
		secure: true,
		sameSite: "Lax",
		maxAge: REFRESH_MAX_AGE,
		prefix: "secure",
	});
};

export const clearAuthCookies = (c: CookieContext): void => {
	deleteCookie(c, ACCESS_COOKIE, {
		path: ACCESS_PATH,
		secure: true,
		prefix: "host",
	});
	deleteCookie(c, ACCESS_COOKIE, {
		path: ACCESS_PATH,
		secure: true,
	});
	deleteCookie(c, REFRESH_COOKIE, {
		path: REFRESH_PATH,
		secure: true,
		prefix: "secure",
	});
	deleteCookie(c, REFRESH_COOKIE, {
		path: REFRESH_PATH,
		secure: true,
	});
};
