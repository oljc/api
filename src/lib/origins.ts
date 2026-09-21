/** 解析 CORS_ORIGINS（逗号分隔、去空白、去重） */
export const parseOrigins = (raw: string | undefined): string[] => {
	if (!raw) return [];
	const seen = new Set<string>();
	const origins: string[] = [];
	for (const part of raw.split(",")) {
		const origin = part.trim();
		if (!origin || seen.has(origin)) continue;
		seen.add(origin);
		origins.push(origin);
	}
	return origins;
};

export const isAllowedOrigin = (
	origin: string,
	allowlist: readonly string[],
): boolean => {
	return allowlist.includes(origin);
};
