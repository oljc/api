import { sql } from "@/db/client";
import {
	listActiveTenants,
	type PublicTenant,
	type PublicUser,
	toPublicTenant,
	toPublicUser,
} from "@/features/auth";
import { AppError } from "@/lib/errors";
import type { CreateTenantInput } from "./schema";

type RoleTemplate = {
	id: string;
	code: string;
	name: string;
	description: string | null;
};

type RolePermTemplate = {
	role_id: string;
	permission_id: string;
};

const slugifyTenantKey = (name: string): string => {
	const base = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
	if (base.length >= 2) return base;
	return `org-${crypto.randomUUID().slice(0, 8)}`;
};

const ensureUniqueTenantKey = async (preferred: string): Promise<string> => {
	let candidate = preferred;
	for (let i = 0; i < 8; i++) {
		const rows = await sql`
			SELECT 1 FROM tenant
			WHERE tenant_key = ${candidate} AND delete_time IS NULL
			LIMIT 1
		`;
		if (rows.length === 0) return candidate;
		candidate = `${preferred.slice(0, 40)}-${crypto.randomUUID().slice(0, 6)}`;
	}
	return `org-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
};

export const listTenants = async (
	accountId: string,
): Promise<{
	items: Array<PublicTenant & { user: PublicUser }>;
}> => {
	const rows = await listActiveTenants(accountId);
	return {
		items: rows.map((row) => ({
			...toPublicTenant(row),
			user: toPublicUser(row),
		})),
	};
};

export const createTenant = async (
	accountId: string,
	sessionId: string,
	input: CreateTenantInput,
): Promise<{
	tenant: PublicTenant;
	user: PublicUser;
}> => {
	const tenantKey = await ensureUniqueTenantKey(
		input.tenantKey ?? slugifyTenantKey(input.name),
	);

	const accountRows = await sql`
		SELECT name FROM account
		WHERE id = ${accountId} AND delete_time IS NULL
		LIMIT 1
	`;
	const accountName =
		(accountRows[0] as { name: string | null } | undefined)?.name ?? null;

	const templates = (await sql`
		SELECT id, code, name, description
		FROM role
		WHERE tenant_id IS NULL
			AND delete_time IS NULL
			AND code IN ('owner', 'admin', 'member')
	`) as RoleTemplate[];

	if (templates.length < 3) {
		throw new AppError(500, "系统角色模板未就绪，请先执行种子迁移");
	}

	const perms = (await sql`
		SELECT rp.role_id, rp.permission_id
		FROM role_perm rp
		INNER JOIN role r ON r.id = rp.role_id
		WHERE r.tenant_id IS NULL
			AND r.delete_time IS NULL
			AND r.code IN ('owner', 'admin', 'member')
	`) as RolePermTemplate[];

	const tenantId = crypto.randomUUID();
	const userId = crypto.randomUUID();
	const roleIdByCode = new Map<string, string>();
	for (const t of templates) {
		roleIdByCode.set(t.code, crypto.randomUUID());
	}

	const ownerRoleId = roleIdByCode.get("owner");
	if (!ownerRoleId) {
		throw new AppError(500, "缺少 owner 角色模板");
	}

	const roleInserts = templates.map((t) => {
		const newId = roleIdByCode.get(t.code);
		if (!newId) throw new AppError(500, `角色模板缺失: ${t.code}`);
		return sql`
			INSERT INTO role (id, tenant_id, code, name, description, is_system)
			VALUES (
				${newId},
				${tenantId},
				${t.code},
				${t.name},
				${t.description},
				true
			)
		`;
	});

	const rolePermInserts = perms.map((p) => {
		const template = templates.find((t) => t.id === p.role_id);
		const newRoleId = template ? roleIdByCode.get(template.code) : undefined;
		if (!newRoleId) {
			throw new AppError(500, "角色权限复制失败");
		}
		return sql`
			INSERT INTO role_perm (role_id, permission_id)
			VALUES (${newRoleId}, ${p.permission_id})
		`;
	});

	try {
		await sql.transaction([
			sql`
				INSERT INTO tenant (id, tenant_key, name, status, owner_account_id)
				VALUES (${tenantId}, ${tenantKey}, ${input.name}, 1, ${accountId})
			`,
			...roleInserts,
			...rolePermInserts,
			sql`
				INSERT INTO "user" (
					id, tenant_id, account_id, name, status, join_time
				)
				SELECT
					${userId},
					${tenantId},
					${accountId},
					a.name,
					1,
					now()
				FROM account a
				WHERE a.id = ${accountId}
			`,
			sql`
				INSERT INTO user_role (user_id, role_id, tenant_id)
				VALUES (${userId}, ${ownerRoleId}, ${tenantId})
			`,
			sql`
				UPDATE session
				SET tenant_id = ${tenantId}, update_time = now()
				WHERE id = ${sessionId} AND revoke_time IS NULL
			`,
		]);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.includes("tenant_key_uk") || message.includes("23505")) {
			throw new AppError(409, "工作区标识已被占用");
		}
		throw err;
	}

	return {
		tenant: {
			id: tenantId,
			tenantKey,
			name: input.name,
			avatar: null,
		},
		user: {
			id: userId,
			name: accountName,
			avatar: null,
			status: 1,
		},
	};
};

export const switchTenant = async (
	accountId: string,
	sessionId: string,
	tenantId: string,
): Promise<{
	tenant: PublicTenant;
	user: PublicUser;
}> => {
	const members = await listActiveTenants(accountId);
	const matched = members.find((m) => m.tenant_id === tenantId);
	if (!matched) {
		throw new AppError(403, "你不是该工作区的成员");
	}

	await sql`
		UPDATE session
		SET tenant_id = ${tenantId}, update_time = now()
		WHERE id = ${sessionId} AND revoke_time IS NULL
	`;

	return {
		tenant: toPublicTenant(matched),
		user: toPublicUser(matched),
	};
};
