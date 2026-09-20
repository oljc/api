-- 有状态验证码：答案哈希入库，校验时原子删除
DROP TABLE IF EXISTS captcha_nonce;

CREATE TABLE IF NOT EXISTS captcha (
	id uuid PRIMARY KEY,
	answer_hash text NOT NULL,
	expire_time timestamptz NOT NULL,
	create_time timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS captcha_expire_idx
	ON captcha (expire_time);
