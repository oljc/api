import { AppError } from "@/lib/errors";
import type { CreateUserInput, UpdateUserInput, User } from "@/schemas/users";

/** 示例用内存存储，进程重启后数据会丢失 */
const usersStore = new Map<string, User>([
	[
		"1",
		{
			id: "1",
			name: "Alice",
			email: "alice@example.com",
			createdAt: new Date().toISOString(),
		},
	],
]);

export function listUsers(): User[] {
	return Array.from(usersStore.values());
}

export function getUser(id: string): User {
	const user = usersStore.get(id);
	if (!user) {
		throw new AppError(404, "未找到该用户");
	}
	return user;
}

export function createUser(input: CreateUserInput): User {
	const user: User = {
		id: crypto.randomUUID(),
		name: input.name,
		email: input.email,
		createdAt: new Date().toISOString(),
	};
	usersStore.set(user.id, user);
	return user;
}

export function updateUser(id: string, input: UpdateUserInput): User {
	const existing = getUser(id);
	const user: User = {
		...existing,
		name: input.name ?? existing.name,
		email: input.email ?? existing.email,
	};
	usersStore.set(id, user);
	return user;
}

export function deleteUser(id: string): { id: string } {
	getUser(id);
	usersStore.delete(id);
	return { id };
}
