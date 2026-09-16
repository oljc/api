export class AppError extends Error {
	readonly code: number;
	readonly status: number;
	readonly data: unknown;

	constructor(
		code: number,
		message: string,
		options?: { status?: number; data?: unknown; cause?: unknown },
	) {
		super(message, { cause: options?.cause });
		this.name = "AppError";
		this.code = code;
		this.status = options?.status ?? (code >= 400 && code < 600 ? code : 400);
		this.data = options?.data ?? null;
	}
}
