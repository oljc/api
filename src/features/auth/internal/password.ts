import { randomBytes } from "node:crypto";
import { argon2id, argon2Verify } from "hash-wasm";

/** OWASP 建议量级；与 credential.password_algo=argon2id 对齐 */
export const hashPassword = async (password: string): Promise<string> => {
	const salt = randomBytes(16);
	return argon2id({
		password,
		salt,
		parallelism: 1,
		iterations: 2,
		memorySize: 19_456, // KiB
		hashLength: 32,
		outputType: "encoded",
	});
};

export const verifyPassword = async (
	password: string,
	passwordHash: string,
): Promise<boolean> => {
	try {
		return await argon2Verify({ password, hash: passwordHash });
	} catch {
		return false;
	}
};
