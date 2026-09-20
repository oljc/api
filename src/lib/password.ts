import { randomBytes } from "node:crypto";
import { argon2id, argon2Verify } from "hash-wasm";

/** OWASP 建议量级；与 credential.password_algo=argon2id 对齐 */
const MEMORY_SIZE = 19_456; // KiB
const ITERATIONS = 2;
const PARALLELISM = 1;
const HASH_LENGTH = 32;
const SALT_LENGTH = 16;

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(SALT_LENGTH);
	return argon2id({
		password,
		salt,
		parallelism: PARALLELISM,
		iterations: ITERATIONS,
		memorySize: MEMORY_SIZE,
		hashLength: HASH_LENGTH,
		outputType: "encoded",
	});
}

export async function verifyPassword(
	password: string,
	passwordHash: string,
): Promise<boolean> {
	try {
		return await argon2Verify({ password, hash: passwordHash });
	} catch {
		return false;
	}
}
