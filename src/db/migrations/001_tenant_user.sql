-- 租户用户体系
-- 鉴权路径: session -> account -> user(tenant_id) -> user_role -> role_perm -> permission.code
-- ID 语义: account.id ≈ union 主体; user.id = 租户内 user_id（租户成员，非全局 User）
--
-- 登录 vs 通讯录:
--   identity.identity_type/key = 登录身份（email/mobile/oauth…）；登录只查 identity
--   user.email/mobile/enterprise_email = 通讯录展示资料，禁止当作登录账号
--
-- 生命周期:
--   account.status: 1正常 2锁定 3注销中（账号级禁用/注销）
--   tenant.status:  1正常 2停用
--   user.status:    1在职(activated) 2停用 3待加入(unjoin) 4已离职(exited)
--                   移出租户/停用成员/离职落在 user，不改 account
--
-- employee_type: 1正式 2实习 3外包 4劳务 5顾问
-- identity_type: email | mobile | google | apple | github | feishu | ...
-- gender:        0未知 1男 2女
--
-- department.path: 反范式缓存，由应用在写部门时维护，与 parent_id 保持一致
-- role.tenant_id IS NULL: 系统模板，仅用于创建租户时复制；禁止直接挂到 user_role/invite

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ========== 账号域 ==========

CREATE TABLE account (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	status smallint NOT NULL DEFAULT 1,
	name text,
	avatar text,
	locale text NOT NULL DEFAULT 'zh-CN',
	timezone text NOT NULL DEFAULT 'Asia/Shanghai',
	last_login_time timestamptz,
	extra jsonb NOT NULL DEFAULT '{}'::jsonb,
	create_time timestamptz NOT NULL DEFAULT now(),
	update_time timestamptz NOT NULL DEFAULT now(),
	delete_time timestamptz,
	CONSTRAINT account_status_check CHECK (status IN (1, 2, 3))
);

CREATE TABLE identity (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	account_id uuid NOT NULL REFERENCES account (id) ON DELETE CASCADE,
	identity_type text NOT NULL,
	identity_key text NOT NULL,
	verified_time timestamptz,
	is_primary boolean NOT NULL DEFAULT false,
	extra jsonb NOT NULL DEFAULT '{}'::jsonb,
	create_time timestamptz NOT NULL DEFAULT now(),
	update_time timestamptz NOT NULL DEFAULT now(),
	delete_time timestamptz
);

CREATE UNIQUE INDEX identity_type_key_uk
	ON identity (identity_type, identity_key)
	WHERE delete_time IS NULL;

CREATE INDEX identity_account_id_idx ON identity (account_id);

CREATE TABLE credential (
	account_id uuid PRIMARY KEY REFERENCES account (id) ON DELETE CASCADE,
	password_hash text NOT NULL,
	password_algo text NOT NULL DEFAULT 'argon2id',
	password_update_time timestamptz NOT NULL DEFAULT now(),
	fail_count int NOT NULL DEFAULT 0,
	lock_until timestamptz
);

CREATE TABLE passkey (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	account_id uuid NOT NULL REFERENCES account (id) ON DELETE CASCADE,
	credential_id bytea NOT NULL,
	public_key bytea NOT NULL,
	sign_count bigint NOT NULL DEFAULT 0,
	transports text[],
	aaguid uuid,
	name text,
	last_use_time timestamptz,
	create_time timestamptz NOT NULL DEFAULT now(),
	delete_time timestamptz,
	CONSTRAINT passkey_credential_id_uk UNIQUE (credential_id)
);

CREATE INDEX passkey_account_id_idx ON passkey (account_id);

CREATE TABLE mfa (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	account_id uuid NOT NULL REFERENCES account (id) ON DELETE CASCADE,
	mfa_type text NOT NULL,
	secret text,
	verified_time timestamptz,
	create_time timestamptz NOT NULL DEFAULT now(),
	delete_time timestamptz,
	CONSTRAINT mfa_type_check CHECK (mfa_type IN ('totp', 'backup'))
);

CREATE INDEX mfa_account_id_idx ON mfa (account_id);

-- ========== 会话域 ==========

CREATE TABLE session (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	account_id uuid NOT NULL REFERENCES account (id) ON DELETE CASCADE,
	tenant_id uuid,
	token_hash text NOT NULL,
	refresh_hash text,
	expire_time timestamptz NOT NULL,
	refresh_expire_time timestamptz,
	ip inet,
	user_agent text,
	device_id text,
	device_name text,
	revoke_time timestamptz,
	create_time timestamptz NOT NULL DEFAULT now(),
	update_time timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT session_token_hash_uk UNIQUE (token_hash),
	CONSTRAINT session_refresh_hash_uk UNIQUE (refresh_hash)
);

CREATE INDEX session_account_active_idx
	ON session (account_id)
	WHERE revoke_time IS NULL;

-- ========== 租户域 ==========

CREATE TABLE tenant (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	tenant_key text NOT NULL,
	name text NOT NULL,
	avatar text,
	status smallint NOT NULL DEFAULT 1,
	owner_account_id uuid REFERENCES account (id),
	extra jsonb NOT NULL DEFAULT '{}'::jsonb,
	create_time timestamptz NOT NULL DEFAULT now(),
	update_time timestamptz NOT NULL DEFAULT now(),
	delete_time timestamptz,
	CONSTRAINT tenant_key_uk UNIQUE (tenant_key),
	CONSTRAINT tenant_status_check CHECK (status IN (1, 2))
);

ALTER TABLE session
	ADD CONSTRAINT session_tenant_id_fk
	FOREIGN KEY (tenant_id) REFERENCES tenant (id);

CREATE TABLE department (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	tenant_id uuid NOT NULL REFERENCES tenant (id) ON DELETE CASCADE,
	parent_id uuid,
	name text NOT NULL,
	orders int NOT NULL DEFAULT 0,
	-- path 由应用维护，勿与 parent_id 脱节
	path text,
	leader_user_id uuid,
	extra jsonb NOT NULL DEFAULT '{}'::jsonb,
	create_time timestamptz NOT NULL DEFAULT now(),
	update_time timestamptz NOT NULL DEFAULT now(),
	delete_time timestamptz,
	CONSTRAINT department_id_tenant_uk UNIQUE (id, tenant_id)
);

CREATE INDEX department_tenant_parent_idx ON department (tenant_id, parent_id);

-- 同租户父子部门
ALTER TABLE department
	ADD CONSTRAINT department_parent_same_tenant_fk
	FOREIGN KEY (parent_id, tenant_id)
	REFERENCES department (id, tenant_id);

-- "user" = 租户成员（飞书 Contact User），非全局登录主体
CREATE TABLE "user" (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	tenant_id uuid NOT NULL REFERENCES tenant (id) ON DELETE CASCADE,
	account_id uuid NOT NULL REFERENCES account (id),
	name text,
	en_name text,
	avatar text,
	email text,
	mobile text,
	enterprise_email text,
	employee_no text,
	employee_type smallint,
	job_title text,
	gender smallint NOT NULL DEFAULT 0,
	leader_user_id uuid,
	status smallint NOT NULL DEFAULT 1,
	join_time timestamptz,
	extra jsonb NOT NULL DEFAULT '{}'::jsonb,
	create_time timestamptz NOT NULL DEFAULT now(),
	update_time timestamptz NOT NULL DEFAULT now(),
	delete_time timestamptz,
	CONSTRAINT user_status_check CHECK (status IN (1, 2, 3, 4)),
	CONSTRAINT user_gender_check CHECK (gender IN (0, 1, 2)),
	CONSTRAINT user_employee_type_check CHECK (
		employee_type IS NULL OR employee_type IN (1, 2, 3, 4, 5)
	),
	CONSTRAINT user_id_tenant_uk UNIQUE (id, tenant_id)
);

CREATE UNIQUE INDEX user_tenant_account_uk
	ON "user" (tenant_id, account_id)
	WHERE delete_time IS NULL;

CREATE UNIQUE INDEX user_tenant_employee_no_uk
	ON "user" (tenant_id, employee_no)
	WHERE delete_time IS NULL AND employee_no IS NOT NULL;

CREATE INDEX user_account_id_idx ON "user" (account_id);
CREATE INDEX user_tenant_status_idx ON "user" (tenant_id, status);

-- 同租户直属上级
ALTER TABLE "user"
	ADD CONSTRAINT user_leader_same_tenant_fk
	FOREIGN KEY (leader_user_id, tenant_id)
	REFERENCES "user" (id, tenant_id);

-- 部门负责人须同租户
ALTER TABLE department
	ADD CONSTRAINT department_leader_same_tenant_fk
	FOREIGN KEY (leader_user_id, tenant_id)
	REFERENCES "user" (id, tenant_id);

-- 多部门；主部门用 is_primary（每用户至多一个主部门）
CREATE TABLE user_dept (
	user_id uuid NOT NULL,
	dept_id uuid NOT NULL,
	tenant_id uuid NOT NULL REFERENCES tenant (id) ON DELETE CASCADE,
	is_primary boolean NOT NULL DEFAULT false,
	user_order int NOT NULL DEFAULT 0,
	department_order int NOT NULL DEFAULT 0,
	create_time timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (user_id, dept_id),
	CONSTRAINT user_dept_user_same_tenant_fk
		FOREIGN KEY (user_id, tenant_id)
		REFERENCES "user" (id, tenant_id)
		ON DELETE CASCADE,
	CONSTRAINT user_dept_dept_same_tenant_fk
		FOREIGN KEY (dept_id, tenant_id)
		REFERENCES department (id, tenant_id)
		ON DELETE CASCADE
);

CREATE UNIQUE INDEX user_dept_primary_uk
	ON user_dept (user_id)
	WHERE is_primary = true;

CREATE INDEX user_dept_dept_id_idx ON user_dept (dept_id);
CREATE INDEX user_dept_tenant_id_idx ON user_dept (tenant_id);

-- ========== 权限域（先于 invite，供 role_id FK） ==========

CREATE TABLE permission (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	code text NOT NULL,
	name text NOT NULL,
	description text,
	module text NOT NULL,
	CONSTRAINT permission_code_uk UNIQUE (code)
);

CREATE TABLE role (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	tenant_id uuid REFERENCES tenant (id) ON DELETE CASCADE,
	code text NOT NULL,
	name text NOT NULL,
	description text,
	is_system boolean NOT NULL DEFAULT false,
	create_time timestamptz NOT NULL DEFAULT now(),
	update_time timestamptz NOT NULL DEFAULT now(),
	delete_time timestamptz,
	-- 租户实例角色可被复合 FK 引用；模板 (tenant_id IS NULL) 不进此唯一约束
	CONSTRAINT role_id_tenant_uk UNIQUE (id, tenant_id)
);

CREATE UNIQUE INDEX role_template_code_uk
	ON role (code)
	WHERE tenant_id IS NULL AND delete_time IS NULL;

CREATE UNIQUE INDEX role_tenant_code_uk
	ON role (tenant_id, code)
	WHERE tenant_id IS NOT NULL AND delete_time IS NULL;

CREATE TABLE role_perm (
	role_id uuid NOT NULL REFERENCES role (id) ON DELETE CASCADE,
	permission_id uuid NOT NULL REFERENCES permission (id) ON DELETE CASCADE,
	PRIMARY KEY (role_id, permission_id)
);

-- 仅允许绑定租户实例角色（tenant_id NOT NULL），禁止模板 role
CREATE TABLE user_role (
	user_id uuid NOT NULL,
	role_id uuid NOT NULL,
	tenant_id uuid NOT NULL REFERENCES tenant (id) ON DELETE CASCADE,
	create_time timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (user_id, role_id),
	CONSTRAINT user_role_user_same_tenant_fk
		FOREIGN KEY (user_id, tenant_id)
		REFERENCES "user" (id, tenant_id)
		ON DELETE CASCADE,
	CONSTRAINT user_role_role_same_tenant_fk
		FOREIGN KEY (role_id, tenant_id)
		REFERENCES role (id, tenant_id)
		ON DELETE CASCADE
);

CREATE INDEX user_role_tenant_id_idx ON user_role (tenant_id);

-- ========== 邀请 ==========

CREATE TABLE invite (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	tenant_id uuid NOT NULL REFERENCES tenant (id) ON DELETE CASCADE,
	email text,
	mobile text,
	role_id uuid,
	token_hash text NOT NULL,
	inviter_id uuid REFERENCES account (id),
	expire_time timestamptz,
	accept_time timestamptz,
	create_time timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT invite_token_hash_uk UNIQUE (token_hash),
	CONSTRAINT invite_contact_check CHECK (email IS NOT NULL OR mobile IS NOT NULL),
	-- role_id 非空时必须是本租户实例角色（模板 tenant_id IS NULL 无法匹配复合 FK）
	CONSTRAINT invite_role_same_tenant_fk
		FOREIGN KEY (role_id, tenant_id)
		REFERENCES role (id, tenant_id)
);

CREATE INDEX invite_tenant_id_idx ON invite (tenant_id);

-- ========== 审计 ==========

CREATE TABLE audit_log (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	account_id uuid,
	tenant_id uuid,
	event text NOT NULL,
	request_id text,
	target_type text,
	target_id uuid,
	-- 1成功 2失败
	result smallint,
	ip inet,
	user_agent text,
	extra jsonb NOT NULL DEFAULT '{}'::jsonb,
	create_time timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT audit_log_result_check CHECK (result IS NULL OR result IN (1, 2))
);

CREATE INDEX audit_log_account_time_idx ON audit_log (account_id, create_time DESC);
CREATE INDEX audit_log_tenant_time_idx ON audit_log (tenant_id, create_time DESC);
CREATE INDEX audit_log_request_id_idx ON audit_log (request_id)
	WHERE request_id IS NOT NULL;
CREATE INDEX audit_log_target_idx ON audit_log (target_type, target_id)
	WHERE target_type IS NOT NULL;
