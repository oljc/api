-- 权限目录 + 系统角色模板（tenant_id IS NULL）
-- 创建租户时复制模板 role 到该 tenant_id（得到实例角色后再挂 user_role / invite）
-- 禁止把模板 role.id 直接写入 user_role / invite（由复合 FK 保证）

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
SELECT v.code, v.name, v.description, true
FROM (
	VALUES
		('owner', '所有者', '拥有租户全部权限'),
		('admin', '管理员', '管理成员、部门与角色'),
		('member', '成员', '基础通讯录只读')
) AS v(code, name, description)
WHERE NOT EXISTS (
	SELECT 1 FROM role r
	WHERE r.tenant_id IS NULL AND r.code = v.code AND r.delete_time IS NULL
);

-- owner: 全部权限
INSERT INTO role_perm (role_id, permission_id)
SELECT r.id, p.id
FROM role r
CROSS JOIN permission p
WHERE r.tenant_id IS NULL AND r.code = 'owner' AND r.delete_time IS NULL
ON CONFLICT DO NOTHING;

-- admin: 管理能力
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

-- member: 只读
INSERT INTO role_perm (role_id, permission_id)
SELECT r.id, p.id
FROM role r
CROSS JOIN permission p
WHERE r.tenant_id IS NULL
	AND r.code = 'member'
	AND r.delete_time IS NULL
	AND p.code IN ('tenant.read', 'contact.user.read')
ON CONFLICT DO NOTHING;
