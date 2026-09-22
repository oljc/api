export type ApiResponse<T> = {
	code: number;
	message: string;
	data: T;
	traceId?: string;
};

export const API_CODE_OK = 0 as const;

export type Env = {
	API_TOKEN?: string;
	DATABASE_URL?: string;
	[key: string]: string | undefined;
};

export type Variables = {
	traceId: string;
	accountId?: string;
	sessionId?: string;
	tenantId?: string | null;
	userId?: string | null;
};

export type AppEnv = {
	Bindings: Env;
	Variables: Variables;
};
