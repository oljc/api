import { Hono } from "hono";
import { ok } from "@/lib/response";
import { zValidator } from "@/lib/validator";
import {
	createUserSchema,
	updateUserSchema,
	userIdParamSchema,
} from "@/schemas/users";
import * as usersService from "@/services/users";
import type { AppEnv } from "@/types/api";

export const usersRoutes = new Hono<AppEnv>();

usersRoutes.get("/", (c) => ok(c, { items: usersService.listUsers() }));

usersRoutes.get("/:id", zValidator("param", userIdParamSchema), (c) => {
	const { id } = c.req.valid("param");
	return ok(c, { user: usersService.getUser(id) });
});

usersRoutes.post("/", zValidator("json", createUserSchema), (c) => {
	const input = c.req.valid("json");
	const user = usersService.createUser(input);
	return ok(c, { user }, "创建成功", 201);
});

usersRoutes.put(
	"/:id",
	zValidator("param", userIdParamSchema),
	zValidator("json", updateUserSchema),
	(c) => {
		const { id } = c.req.valid("param");
		const input = c.req.valid("json");
		return ok(c, { user: usersService.updateUser(id, input) });
	},
);

usersRoutes.delete("/:id", zValidator("param", userIdParamSchema), (c) => {
	const { id } = c.req.valid("param");
	return ok(c, usersService.deleteUser(id));
});
