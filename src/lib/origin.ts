const cache = new Map<string, boolean>();

export const isTrustedOrigin = (origin: string): boolean => {
	const hit = cache.get(origin);
	if (hit !== undefined) return hit;

	let ok = false;
	if (origin.startsWith("https://")) {
		const host = origin.slice(8);
		ok = host === "ooljc.com" || host.endsWith(".ooljc.com");
	} else if (
		process.env.NODE_ENV !== "production" &&
		(origin === "http://localhost" ||
			origin.startsWith("http://localhost:") ||
			origin === "http://127.0.0.1" ||
			origin.startsWith("http://127.0.0.1:"))
	) {
		ok = true;
	}

	if (cache.size >= 256) cache.clear();
	cache.set(origin, ok);
	return ok;
};
