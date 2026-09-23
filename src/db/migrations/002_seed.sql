BEGIN;

SET LOCAL ROLE seed;

INSERT INTO permission (code, name, description, module)
VALUES
	('tenant.read', '查看租户', '查看租户基本信息', 'admin'),
	('tenant.setting.write', '修改租户设置', '修改租户配置与品牌信息', 'admin'),
	('contact.user.read', '查看成员', '查看通讯录成员', 'contact'),
	('contact.user.write', '管理成员', '创建、更新、停用成员', 'contact'),
	('contact.dept.write', '管理部门', '创建、更新、删除部门', 'contact'),
	('admin.role.write', '管理角色', '配置角色与权限', 'admin')
ON CONFLICT (code) DO UPDATE
SET
	name = EXCLUDED.name,
	description = EXCLUDED.description,
	module = EXCLUDED.module;

INSERT INTO role (code, name, description, is_system)
VALUES
	('owner', '所有者', '拥有租户全部权限', true),
	('admin', '管理员', '管理成员、部门与角色', true),
	('member', '成员', '基础通讯录只读', true)
ON CONFLICT (code)
	WHERE tenant_id IS NULL AND delete_time IS NULL
DO UPDATE SET
	name = EXCLUDED.name,
	description = EXCLUDED.description,
	is_system = true;

INSERT INTO role_perm (role_id, permission_id)
SELECT r.id, p.id
FROM role r
CROSS JOIN permission p
WHERE r.tenant_id IS NULL AND r.code = 'owner' AND r.delete_time IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO role_perm (role_id, permission_id)
SELECT r.id, p.id
FROM role r
CROSS JOIN permission p
WHERE r.tenant_id IS NULL
	AND r.code = 'admin'
	AND r.delete_time IS NULL
	AND p.code IN (
		'tenant.read',
		'tenant.setting.write',
		'contact.user.read',
		'contact.user.write',
		'contact.dept.write',
		'admin.role.write'
	)
ON CONFLICT DO NOTHING;

INSERT INTO role_perm (role_id, permission_id)
SELECT r.id, p.id
FROM role r
CROSS JOIN permission p
WHERE r.tenant_id IS NULL
	AND r.code = 'member'
	AND r.delete_time IS NULL
	AND p.code IN ('tenant.read', 'contact.user.read')
ON CONFLICT DO NOTHING;

DELETE FROM role_perm rp
USING role r, permission p
WHERE rp.role_id = r.id
	AND rp.permission_id = p.id
	AND r.tenant_id IS NULL
	AND r.delete_time IS NULL
	AND (
		(
			r.code = 'admin'
			AND p.code NOT IN (
				'tenant.read',
				'tenant.setting.write',
				'contact.user.read',
				'contact.user.write',
				'contact.dept.write',
				'admin.role.write'
			)
		)
		OR (
			r.code = 'member'
			AND p.code NOT IN ('tenant.read', 'contact.user.read')
		)
	);

COMMIT;
