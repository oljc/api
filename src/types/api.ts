import type {
	PublicAccount,
	PublicTenant,
	PublicUser,
} from "@/features/auth/types";

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
	authAccount?: PublicAccount;
	authTenant?: PublicTenant | null;
	authUser?: PublicUser | null;
};

export type AppEnv = {
	Bindings: Env;
	Variables: Variables;
};
