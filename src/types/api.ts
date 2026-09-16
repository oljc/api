/** 统一接口响应结构 */
export type ApiResponse<T> = {
	code: number;
	message: string;
	data: T;
	traceId?: string;
};

/** 业务成功码（code === 0） */
export const API_CODE_OK = 0 as const;

/** EdgeOne 注入的环境变量；运行时请用 c.env，不要用 process.env */
export type Env = {
	API_TOKEN?: string;
	[key: string]: string | undefined;
};

export type Variables = {
	traceId: string;
};

export type AppEnv = {
	Bindings: Env;
	Variables: Variables;
};
