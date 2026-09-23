import { isUnique, query, sql, transaction } from "@/db/client";
import {
	listActiveTenants,
	type PublicTenant,
	type PublicUser,
	toPublicTenant,
	toPublicUser,
} from "@/features/auth";
import type { TenantMemberRow } from "@/features/auth/types";
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

const loadRoleTemplates = async (): Promise<{
	templates: RoleTemplate[];
	perms: RolePermTemplate[];
}> => {
	const rows = (await sql`
		SELECT
			r.id,
			r.code,
			r.name,
			r.description,
			rp.permission_id
		FROM role r
		LEFT JOIN role_perm rp ON rp.role_id = r.id
		WHERE r.tenant_id IS NULL
			AND r.delete_time IS NULL
			AND r.code IN ('owner', 'admin', 'member')
		ORDER BY r.code, rp.permission_id
	`) as Array<RoleTemplate & { permission_id: string | null }>;

	const byId = new Map<string, RoleTemplate>();
	const perms: RolePermTemplate[] = [];
	for (const row of rows) {
		if (!byId.has(row.id)) {
			byId.set(row.id, {
				id: row.id,
				code: row.code,
				name: row.name,
				description: row.description,
			});
		}
		if (row.permission_id) {
			perms.push({ role_id: row.id, permission_id: row.permission_id });
		}
	}
	return { templates: [...byId.values()], perms };
};

const slugifyTenantKey = (name: string): string => {
	const base = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48)
		.replace(/-+$/g, "");
	if (base.length >= 2) return base;
	return `org-${crypto.randomUUID().slice(0, 8)}`;
};

const isTenantKeyCheck = (error: unknown) => {
	if (!error || typeof error !== "object") return false;
	const value = error as { code?: unknown; constraint?: unknown };
	return value.code === "23514" && value.constraint === "tenant_key_check";
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
	accountName: string | null,
	input: CreateTenantInput,
): Promise<{
	tenant: PublicTenant;
	user: PublicUser;
}> => {
	const tenantKey = input.tenantKey ?? slugifyTenantKey(input.name);
	const { templates, perms } = await loadRoleTemplates();

	if (templates.length < 3) {
		throw new AppError(500, "系统角色模板未就绪，请先执行种子迁移");
	}

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
		await transaction(accountId, tenantId, [
			sql`
				INSERT INTO tenant (id, tenant_key, name, status, owner_account_id)
				VALUES (${tenantId}, ${tenantKey}, ${input.name}, 1, ${accountId})
			`,
			...roleInserts,
			...rolePermInserts,
			sql`
				INSERT INTO "user" (
					id, tenant_id, account_id, name, status, join_time
				) VALUES (
					${userId},
					${tenantId},
					${accountId},
					${accountName},
					1,
					now()
				)
			`,
			sql`
				INSERT INTO user_role (user_id, role_id, tenant_id)
				VALUES (${userId}, ${ownerRoleId}, ${tenantId})
			`,
			sql`
				UPDATE session
				SET tenant_id = ${tenantId}
				WHERE id = ${sessionId} AND revoke_time IS NULL
			`,
		]);
	} catch (err) {
		if (isUnique(err, "tenant_key_uk")) {
			throw new AppError(409, "工作区标识已被占用");
		}
		if (isTenantKeyCheck(err)) {
			throw new AppError(400, "工作区标识格式不正确");
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
	const rows = await query<TenantMemberRow>(
		accountId,
		tenantId,
		sql`
		UPDATE session s
		SET tenant_id = ${tenantId}
		FROM "user" u
		INNER JOIN tenant t ON t.id = u.tenant_id
		WHERE s.id = ${sessionId}
			AND s.account_id = ${accountId}
			AND s.revoke_time IS NULL
			AND u.account_id = ${accountId}
			AND u.tenant_id = ${tenantId}
			AND u.status = 1
			AND u.delete_time IS NULL
			AND t.status = 1
			AND t.delete_time IS NULL
		RETURNING
			t.id AS tenant_id,
			t.tenant_key,
			t.name AS tenant_name,
			t.avatar AS tenant_avatar,
			u.id AS user_id,
			u.name AS user_name,
			u.avatar AS user_avatar,
			u.status AS user_status
		`,
	);
	const matched = rows[0];
	if (!matched) {
		throw new AppError(403, "你不是该工作区的成员");
	}

	return {
		tenant: toPublicTenant(matched),
		user: toPublicUser(matched),
	};
};
