BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE FUNCTION app_account_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
	SELECT NULLIF(current_setting('app.account_id', true), '')::uuid
$$;

CREATE FUNCTION app_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
	SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE FUNCTION touch_update_time()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	NEW.update_time = now();
	RETURN NEW;
END
$$;

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
	CONSTRAINT account_status_check CHECK (status IN (1, 2, 3)),
	CONSTRAINT account_extra_object_check CHECK (jsonb_typeof(extra) = 'object')
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
	delete_time timestamptz,
	CONSTRAINT identity_type_check CHECK (identity_type <> ''),
	CONSTRAINT identity_key_check CHECK (identity_key <> ''),
	CONSTRAINT identity_extra_object_check CHECK (jsonb_typeof(extra) = 'object')
);

CREATE UNIQUE INDEX identity_type_key_uk
	ON identity (identity_type, identity_key)
	WHERE delete_time IS NULL;

CREATE UNIQUE INDEX identity_account_primary_uk
	ON identity (account_id)
	WHERE is_primary AND delete_time IS NULL;

CREATE INDEX identity_account_id_idx ON identity (account_id);

CREATE TABLE credential (
	account_id uuid PRIMARY KEY REFERENCES account (id) ON DELETE CASCADE,
	password_hash text NOT NULL,
	password_algo text NOT NULL DEFAULT 'argon2id',
	password_update_time timestamptz NOT NULL DEFAULT now(),
	fail_count integer NOT NULL DEFAULT 0,
	lock_until timestamptz,
	CONSTRAINT credential_fail_count_check CHECK (fail_count >= 0)
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
	CONSTRAINT passkey_sign_count_check CHECK (sign_count >= 0)
);

CREATE UNIQUE INDEX passkey_credential_id_uk
	ON passkey (credential_id)
	WHERE delete_time IS NULL;

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

CREATE UNIQUE INDEX mfa_account_type_uk
	ON mfa (account_id, mfa_type)
	WHERE delete_time IS NULL;

CREATE TABLE tenant (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	tenant_key text NOT NULL,
	name text NOT NULL,
	avatar text,
	status smallint NOT NULL DEFAULT 1,
	owner_account_id uuid NOT NULL REFERENCES account (id),
	extra jsonb NOT NULL DEFAULT '{}'::jsonb,
	create_time timestamptz NOT NULL DEFAULT now(),
	update_time timestamptz NOT NULL DEFAULT now(),
	delete_time timestamptz,
	CONSTRAINT tenant_key_uk UNIQUE (tenant_key),
	CONSTRAINT tenant_status_check CHECK (status IN (1, 2)),
	CONSTRAINT tenant_key_check CHECK (
		tenant_key ~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$'
	),
	CONSTRAINT tenant_extra_object_check CHECK (jsonb_typeof(extra) = 'object')
);

CREATE TABLE department (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	tenant_id uuid NOT NULL REFERENCES tenant (id) ON DELETE CASCADE,
	parent_id uuid,
	name text NOT NULL,
	orders integer NOT NULL DEFAULT 0,
	path text,
	leader_user_id uuid,
	extra jsonb NOT NULL DEFAULT '{}'::jsonb,
	create_time timestamptz NOT NULL DEFAULT now(),
	update_time timestamptz NOT NULL DEFAULT now(),
	delete_time timestamptz,
	CONSTRAINT department_id_tenant_uk UNIQUE (id, tenant_id),
	CONSTRAINT department_parent_self_check CHECK (parent_id IS NULL OR parent_id <> id),
	CONSTRAINT department_extra_object_check CHECK (jsonb_typeof(extra) = 'object'),
	CONSTRAINT department_parent_same_tenant_fk
		FOREIGN KEY (parent_id, tenant_id)
		REFERENCES department (id, tenant_id)
		DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX department_tenant_parent_idx
	ON department (tenant_id, parent_id, orders)
	WHERE delete_time IS NULL;

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
	CONSTRAINT user_extra_object_check CHECK (jsonb_typeof(extra) = 'object'),
	CONSTRAINT user_id_tenant_uk UNIQUE (id, tenant_id),
	CONSTRAINT user_account_tenant_uk UNIQUE (account_id, tenant_id),
	CONSTRAINT user_leader_same_tenant_fk
		FOREIGN KEY (leader_user_id, tenant_id)
		REFERENCES "user" (id, tenant_id)
		DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX user_account_active_tenant_idx
	ON "user" (account_id, tenant_id)
	WHERE status = 1 AND delete_time IS NULL;

CREATE INDEX user_tenant_status_idx
	ON "user" (tenant_id, status)
	WHERE delete_time IS NULL;

CREATE UNIQUE INDEX user_tenant_employee_no_uk
	ON "user" (tenant_id, employee_no)
	WHERE delete_time IS NULL AND employee_no IS NOT NULL;

ALTER TABLE department
	ADD CONSTRAINT department_leader_same_tenant_fk
	FOREIGN KEY (leader_user_id, tenant_id)
	REFERENCES "user" (id, tenant_id)
	DEFERRABLE INITIALLY IMMEDIATE;

CREATE TABLE user_dept (
	user_id uuid NOT NULL,
	dept_id uuid NOT NULL,
	tenant_id uuid NOT NULL REFERENCES tenant (id) ON DELETE CASCADE,
	is_primary boolean NOT NULL DEFAULT false,
	user_order integer NOT NULL DEFAULT 0,
	department_order integer NOT NULL DEFAULT 0,
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
	WHERE is_primary;

CREATE INDEX user_dept_tenant_dept_idx
	ON user_dept (tenant_id, dept_id, department_order);

CREATE TABLE permission (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	code text NOT NULL,
	name text NOT NULL,
	description text,
	module text NOT NULL,
	CONSTRAINT permission_code_uk UNIQUE (code),
	CONSTRAINT permission_code_check CHECK (
		code ~ '^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$'
	)
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
	CONSTRAINT role_id_tenant_uk UNIQUE (id, tenant_id),
	CONSTRAINT role_code_check CHECK (
		code ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'
	)
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

CREATE INDEX role_perm_permission_id_idx ON role_perm (permission_id);

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

CREATE INDEX user_role_tenant_user_idx ON user_role (tenant_id, user_id);

CREATE TABLE invite (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	tenant_id uuid NOT NULL REFERENCES tenant (id) ON DELETE CASCADE,
	email text,
	mobile text,
	role_id uuid,
	token_hash text NOT NULL,
	inviter_id uuid REFERENCES account (id),
	status smallint NOT NULL DEFAULT 1,
	expire_time timestamptz NOT NULL,
	accept_time timestamptz,
	revoke_time timestamptz,
	create_time timestamptz NOT NULL DEFAULT now(),
	update_time timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT invite_token_hash_uk UNIQUE (token_hash),
	CONSTRAINT invite_status_check CHECK (status IN (1, 2, 3, 4)),
	CONSTRAINT invite_contact_check CHECK (
		(email IS NOT NULL)::integer + (mobile IS NOT NULL)::integer = 1
	),
	CONSTRAINT invite_state_check CHECK (
		(status <> 2 OR accept_time IS NOT NULL)
		AND (status <> 3 OR revoke_time IS NOT NULL)
	),
	CONSTRAINT invite_role_same_tenant_fk
		FOREIGN KEY (role_id, tenant_id)
		REFERENCES role (id, tenant_id)
);

CREATE INDEX invite_tenant_pending_idx
	ON invite (tenant_id, expire_time)
	WHERE status = 1;

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
	CONSTRAINT session_refresh_hash_uk UNIQUE (refresh_hash),
	CONSTRAINT session_refresh_pair_check CHECK (
		(refresh_hash IS NULL) = (refresh_expire_time IS NULL)
	),
	CONSTRAINT session_expire_check CHECK (
		refresh_expire_time IS NULL OR refresh_expire_time > expire_time
	),
	CONSTRAINT session_account_tenant_fk
		FOREIGN KEY (account_id, tenant_id)
		REFERENCES "user" (account_id, tenant_id)
		DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX session_account_active_idx
	ON session (account_id)
	WHERE revoke_time IS NULL;

CREATE INDEX session_refresh_expire_idx
	ON session (refresh_expire_time)
	WHERE refresh_expire_time IS NOT NULL;

CREATE INDEX session_expire_time_idx
	ON session (expire_time)
	WHERE refresh_expire_time IS NULL;

CREATE INDEX session_revoke_time_idx
	ON session (revoke_time)
	WHERE revoke_time IS NOT NULL;

CREATE TABLE captcha (
	id uuid PRIMARY KEY,
	answer_hash text NOT NULL,
	expire_time timestamptz NOT NULL,
	create_time timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX captcha_expire_idx ON captcha (expire_time);

CREATE TABLE audit_log (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	account_id uuid REFERENCES account (id) ON DELETE SET NULL,
	tenant_id uuid REFERENCES tenant (id) ON DELETE SET NULL,
	event text NOT NULL,
	request_id text,
	target_type text,
	target_id uuid,
	result smallint,
	ip inet,
	user_agent text,
	extra jsonb NOT NULL DEFAULT '{}'::jsonb,
	create_time timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT audit_log_result_check CHECK (result IS NULL OR result IN (1, 2)),
	CONSTRAINT audit_log_extra_object_check CHECK (jsonb_typeof(extra) = 'object')
);

CREATE INDEX audit_log_account_time_idx
	ON audit_log (account_id, create_time DESC);

CREATE INDEX audit_log_tenant_time_idx
	ON audit_log (tenant_id, create_time DESC);

CREATE INDEX audit_log_request_id_idx
	ON audit_log (request_id)
	WHERE request_id IS NOT NULL;

CREATE INDEX audit_log_target_idx
	ON audit_log (target_type, target_id, create_time DESC)
	WHERE target_type IS NOT NULL AND target_id IS NOT NULL;

CREATE INDEX audit_log_time_brin_idx
	ON audit_log USING brin (create_time) WITH (pages_per_range = 64);

CREATE TRIGGER account_touch_update_time
BEFORE UPDATE ON account
FOR EACH ROW EXECUTE FUNCTION touch_update_time();

CREATE TRIGGER identity_touch_update_time
BEFORE UPDATE ON identity
FOR EACH ROW EXECUTE FUNCTION touch_update_time();

CREATE TRIGGER tenant_touch_update_time
BEFORE UPDATE ON tenant
FOR EACH ROW EXECUTE FUNCTION touch_update_time();

CREATE TRIGGER department_touch_update_time
BEFORE UPDATE ON department
FOR EACH ROW EXECUTE FUNCTION touch_update_time();

CREATE TRIGGER user_touch_update_time
BEFORE UPDATE ON "user"
FOR EACH ROW EXECUTE FUNCTION touch_update_time();

CREATE TRIGGER role_touch_update_time
BEFORE UPDATE ON role
FOR EACH ROW EXECUTE FUNCTION touch_update_time();

CREATE TRIGGER invite_touch_update_time
BEFORE UPDATE ON invite
FOR EACH ROW EXECUTE FUNCTION touch_update_time();

CREATE TRIGGER session_touch_update_time
BEFORE UPDATE ON session
FOR EACH ROW EXECUTE FUNCTION touch_update_time();

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
		CREATE ROLE app NOLOGIN NOBYPASSRLS;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'seed') THEN
		CREATE ROLE seed NOLOGIN NOBYPASSRLS;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maint') THEN
		CREATE ROLE maint NOLOGIN NOBYPASSRLS;
	END IF;
END
$$;

GRANT app, seed, maint TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO app, seed, maint;
GRANT SELECT, INSERT, UPDATE, DELETE
	ON account, identity, credential, passkey, mfa, tenant, department,
		"user", user_dept, role, role_perm, user_role, invite, session,
		captcha, audit_log
	TO app;
GRANT SELECT ON permission TO app;
GRANT SELECT, INSERT, UPDATE ON permission, role TO seed;
GRANT SELECT, INSERT, DELETE ON role_perm TO seed;
GRANT SELECT, DELETE ON captcha, session TO maint;
GRANT SELECT, UPDATE ON invite TO maint;
GRANT SELECT, UPDATE, DELETE ON audit_log TO maint;
GRANT EXECUTE ON FUNCTION app_account_id(), app_tenant_id() TO app;
REVOKE EXECUTE ON FUNCTION touch_update_time() FROM PUBLIC;

ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant FORCE ROW LEVEL SECURITY;
ALTER TABLE department ENABLE ROW LEVEL SECURITY;
ALTER TABLE department FORCE ROW LEVEL SECURITY;
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user" FORCE ROW LEVEL SECURITY;
ALTER TABLE user_dept ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_dept FORCE ROW LEVEL SECURITY;
ALTER TABLE role ENABLE ROW LEVEL SECURITY;
ALTER TABLE role FORCE ROW LEVEL SECURITY;
ALTER TABLE role_perm ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_perm FORCE ROW LEVEL SECURITY;
ALTER TABLE user_role ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_role FORCE ROW LEVEL SECURITY;
ALTER TABLE invite ENABLE ROW LEVEL SECURITY;
ALTER TABLE invite FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_select ON tenant
FOR SELECT
USING (
	id = app_tenant_id()
	OR owner_account_id = app_account_id()
	OR EXISTS (
		SELECT 1
		FROM "user" u
		WHERE u.tenant_id = tenant.id
			AND u.account_id = app_account_id()
			AND u.status = 1
			AND u.delete_time IS NULL
	)
);

CREATE POLICY tenant_insert ON tenant
FOR INSERT
WITH CHECK (owner_account_id = app_account_id());

CREATE POLICY tenant_update ON tenant
FOR UPDATE
USING (id = app_tenant_id())
WITH CHECK (id = app_tenant_id());

CREATE POLICY tenant_delete ON tenant
FOR DELETE
USING (id = app_tenant_id());

CREATE POLICY department_tenant ON department
USING (tenant_id = app_tenant_id())
WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY user_select ON "user"
FOR SELECT
USING (
	tenant_id = app_tenant_id()
	OR account_id = app_account_id()
);

CREATE POLICY user_insert ON "user"
FOR INSERT
WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY user_update ON "user"
FOR UPDATE
USING (tenant_id = app_tenant_id())
WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY user_delete ON "user"
FOR DELETE
USING (tenant_id = app_tenant_id());

CREATE POLICY user_dept_tenant ON user_dept
USING (tenant_id = app_tenant_id())
WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY role_select ON role
FOR SELECT
USING (tenant_id IS NULL OR tenant_id = app_tenant_id());

CREATE POLICY role_insert ON role
FOR INSERT
TO app
WITH CHECK (current_user = 'app' AND tenant_id = app_tenant_id());

CREATE POLICY role_seed_insert ON role
FOR INSERT
TO seed
WITH CHECK (current_user = 'seed' AND tenant_id IS NULL);

CREATE POLICY role_update ON role
FOR UPDATE
TO app
USING (current_user = 'app' AND tenant_id = app_tenant_id())
WITH CHECK (current_user = 'app' AND tenant_id = app_tenant_id());

CREATE POLICY role_seed_update ON role
FOR UPDATE
TO seed
USING (current_user = 'seed' AND tenant_id IS NULL)
WITH CHECK (current_user = 'seed' AND tenant_id IS NULL);

CREATE POLICY role_delete ON role
FOR DELETE
TO app
USING (current_user = 'app' AND tenant_id = app_tenant_id());

CREATE POLICY role_perm_select ON role_perm
FOR SELECT
USING (
	EXISTS (
		SELECT 1
		FROM role r
		WHERE r.id = role_perm.role_id
			AND (r.tenant_id IS NULL OR r.tenant_id = app_tenant_id())
	)
);

CREATE POLICY role_perm_insert ON role_perm
FOR INSERT
TO app
WITH CHECK (
	current_user = 'app'
	AND EXISTS (
		SELECT 1
		FROM role r
		WHERE r.id = role_perm.role_id
			AND r.tenant_id = app_tenant_id()
	)
);

CREATE POLICY role_perm_seed_insert ON role_perm
FOR INSERT
TO seed
WITH CHECK (
	current_user = 'seed'
	AND EXISTS (
		SELECT 1
		FROM role r
		WHERE r.id = role_perm.role_id
			AND r.tenant_id IS NULL
	)
);

CREATE POLICY role_perm_delete ON role_perm
FOR DELETE
TO app
USING (
	current_user = 'app'
	AND EXISTS (
		SELECT 1
		FROM role r
		WHERE r.id = role_perm.role_id
			AND r.tenant_id = app_tenant_id()
	)
);

CREATE POLICY role_perm_seed_delete ON role_perm
FOR DELETE
TO seed
USING (
	current_user = 'seed'
	AND EXISTS (
		SELECT 1
		FROM role r
		WHERE r.id = role_perm.role_id
			AND r.tenant_id IS NULL
	)
);

CREATE POLICY user_role_tenant ON user_role
USING (tenant_id = app_tenant_id())
WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY invite_tenant ON invite
USING (tenant_id = app_tenant_id())
WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY invite_maintain_select ON invite
FOR SELECT
TO maint
USING (current_user = 'maint');

CREATE POLICY invite_maintain ON invite
FOR UPDATE
TO maint
USING (current_user = 'maint')
WITH CHECK (current_user = 'maint');

CREATE POLICY audit_log_maintain_select ON audit_log
FOR SELECT
TO maint
USING (current_user = 'maint');

CREATE POLICY audit_log_maintain_update ON audit_log
FOR UPDATE
TO maint
USING (current_user = 'maint')
WITH CHECK (current_user = 'maint');

CREATE POLICY audit_log_maintain ON audit_log
FOR DELETE
TO maint
USING (current_user = 'maint');

CREATE POLICY audit_log_select ON audit_log
FOR SELECT
USING (
	tenant_id = app_tenant_id()
	OR (tenant_id IS NULL AND account_id = app_account_id())
);

CREATE POLICY audit_log_insert ON audit_log
FOR INSERT
WITH CHECK (
	(tenant_id = app_tenant_id() AND account_id = app_account_id())
	OR (tenant_id IS NULL AND account_id = app_account_id())
);

COMMENT ON COLUMN account.status IS '1正常 2锁定 3注销中';
COMMENT ON COLUMN identity.identity_type IS '登录身份类型，如 email、mobile、google、apple、github、feishu';
COMMENT ON COLUMN identity.identity_key IS '规范化后的登录身份值，不作为通讯录资料';
COMMENT ON COLUMN credential.fail_count IS '自最近一次成功登录后的连续密码失败次数';
COMMENT ON COLUMN tenant.status IS '1正常 2停用';
COMMENT ON TABLE "user" IS '租户内成员，不是全局登录账号';
COMMENT ON COLUMN "user".status IS '1在职 2停用 3待加入 4已离职';
COMMENT ON COLUMN "user".employee_type IS '1正式 2实习 3外包 4劳务 5顾问';
COMMENT ON COLUMN "user".gender IS '0未知 1男 2女';
COMMENT ON COLUMN department.path IS '由业务维护的部门路径缓存，必须与 parent_id 一致';
COMMENT ON COLUMN role.tenant_id IS 'NULL 表示创建租户时复制的系统角色模板';
COMMENT ON COLUMN invite.status IS '1待接受 2已接受 3已撤销 4已过期';
COMMENT ON COLUMN session.tenant_id IS '当前会话选择的租户，NULL 表示尚未选择';
COMMENT ON COLUMN audit_log.result IS '1成功 2失败';

COMMIT;
