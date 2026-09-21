export type PublicAccount = {
	id: string;
	name: string | null;
	avatar: string | null;
	locale: string;
	timezone: string;
};

export type PublicTenant = {
	id: string;
	tenantKey: string;
	name: string;
	avatar: string | null;
};

export type PublicUser = {
	id: string;
	name: string | null;
	avatar: string | null;
	status: number;
};

/** 仅内部使用：明文只用于 Set-Cookie，不得写入 JSON */
export type AuthTokens = {
	accessToken: string;
	refreshToken: string;
	expiresAt: string;
};

export type ClientAuthSession = {
	expiresAt: string;
	account: PublicAccount;
	tenant: PublicTenant | null;
	user: PublicUser | null;
};

export type TenantMemberRow = {
	tenant_id: string;
	tenant_key: string;
	tenant_name: string;
	tenant_avatar: string | null;
	user_id: string;
	user_name: string | null;
	user_avatar: string | null;
	user_status: number;
};

export type AccountRow = {
	id: string;
	status: number;
	name: string | null;
	avatar: string | null;
	locale: string;
	timezone: string;
};

export const toClientSession = (
	result: AuthTokens & {
		account: PublicAccount;
		tenant: PublicTenant | null;
		user: PublicUser | null;
	},
): ClientAuthSession => {
	return {
		expiresAt: result.expiresAt,
		account: result.account,
		tenant: result.tenant,
		user: result.user,
	};
};

export const toPublicAccount = (row: AccountRow): PublicAccount => {
	return {
		id: row.id,
		name: row.name,
		avatar: row.avatar,
		locale: row.locale,
		timezone: row.timezone,
	};
};

export const toPublicTenant = (row: TenantMemberRow): PublicTenant => {
	return {
		id: row.tenant_id,
		tenantKey: row.tenant_key,
		name: row.tenant_name,
		avatar: row.tenant_avatar,
	};
};

export const toPublicUser = (row: TenantMemberRow): PublicUser => {
	return {
		id: row.user_id,
		name: row.user_name,
		avatar: row.user_avatar,
		status: row.user_status,
	};
};
