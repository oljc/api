-- 验证码一次性 nonce（防重放；多实例强一致）
CREATE TABLE IF NOT EXISTS captcha_nonce (
	nonce text PRIMARY KEY,
	expire_time timestamptz NOT NULL,
	create_time timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS captcha_nonce_expire_idx
	ON captcha_nonce (expire_time);
