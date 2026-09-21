import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { deflateSync } from "node:zlib";
import { sql } from "@/db/client";
import { AppError } from "@/lib/errors";

const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const FONT = [
	0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11,
	0x1e, 0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e, 0x1e, 0x11, 0x11, 0x11, 0x11,
	0x11, 0x1e, 0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f, 0x1f, 0x10, 0x10, 0x1e,
	0x10, 0x10, 0x10, 0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x11,
	0x1f, 0x11, 0x11, 0x11, 0x0f, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c, 0x11, 0x12,
	0x14, 0x18, 0x14, 0x12, 0x11, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f, 0x11,
	0x1b, 0x15, 0x15, 0x11, 0x11, 0x11, 0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11,
	0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10, 0x0e, 0x11, 0x11, 0x11, 0x15, 0x12,
	0x0d, 0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11, 0x0f, 0x10, 0x10, 0x0e, 0x01,
	0x01, 0x1e, 0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x11, 0x11, 0x11, 0x11,
	0x11, 0x11, 0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04, 0x11, 0x11, 0x11,
	0x15, 0x15, 0x1b, 0x11, 0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11, 0x11, 0x11,
	0x0a, 0x04, 0x04, 0x04, 0x04, 0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f, 0x0e,
	0x11, 0x01, 0x06, 0x08, 0x10, 0x1f, 0x1f, 0x01, 0x02, 0x06, 0x01, 0x11, 0x0e,
	0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02, 0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11,
	0x0e, 0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e, 0x1f, 0x01, 0x02, 0x04, 0x08,
	0x08, 0x08, 0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e, 0x0e, 0x11, 0x11, 0x0f,
	0x01, 0x02, 0x0c,
] as const;

/** 图集 tile 28×36；调色板：0 透明 / 1 灰线 / 2..9 字色 */
const ATLAS = new Uint8Array(32 * 1008);
for (let gi = 0; gi < 32; gi++) {
	const base = gi * 1008;
	const fo = gi * 7;
	for (let fy = 0; fy < 7; fy++) {
		const bits = FONT[fo + fy] ?? 0;
		for (let fx = 0; fx < 5; fx++) {
			if (((bits >> (4 - fx)) & 1) === 0) continue;
			const x0 = 2 + fx * 5;
			const y0 = 1 + fy * 5;
			for (let dy = 0; dy < 5; dy++) {
				const row = base + (y0 + dy) * 28 + x0;
				ATLAS.fill(255, row, row + 5);
			}
		}
	}
}

const CHAR_IDX = new Int8Array(128).fill(-1);
for (let i = 0; i < 32; i++) CHAR_IDX[CHARSET.charCodeAt(i)] = i;

const CRC_TAB = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	CRC_TAB[n] = c >>> 0;
}

const crc32 = (buf: Uint8Array) => {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i++)
		c = (CRC_TAB[(c ^ (buf[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Uint8Array) => {
	const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
	const out = Buffer.allocUnsafe(4 + body.length + 4);
	out.writeUInt32BE(data.length, 0);
	body.copy(out, 4);
	out.writeUInt32BE(crc32(body), 4 + body.length);
	return out;
};

/** 固定帧：签名 + IHDR(160×60 索引色) + PLTE + tRNS(0 透明) + IEND */
const PNG_HEAD = Buffer.concat([
	Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
	chunk("IHDR", Uint8Array.of(0, 0, 0, 160, 0, 0, 0, 60, 8, 3, 0, 0, 0)),
	chunk(
		"PLTE",
		Uint8Array.of(
			0x00,
			0x00,
			0x00, // 0 占位（透明）
			0x94,
			0xa3,
			0xb8, // 1 干扰灰
			0x1a,
			0x56,
			0xdb,
			0x0e,
			0x9f,
			0x6e,
			0xc2,
			0x78,
			0x03,
			0xe0,
			0x24,
			0x24,
			0x7e,
			0x3a,
			0xf2,
			0x06,
			0x94,
			0xa2,
			0xd6,
			0x1f,
			0x69,
			0x58,
			0x50,
			0xec,
		),
	),
	chunk("tRNS", Uint8Array.of(0)),
]);
const PNG_IEND = chunk("IEND", new Uint8Array(0));

/** 索引色 PNG；透明底 + level 9 → base64 更小 */
const encodePng = (pix: Uint8Array) => {
	const raw = Buffer.allocUnsafe(60 * 161);
	for (let y = 0; y < 60; y++) {
		const o = y * 161;
		raw[o] = 0;
		raw.set(pix.subarray(y * 160, y * 160 + 160), o + 1);
	}
	return Buffer.concat([
		PNG_HEAD,
		chunk("IDAT", deflateSync(raw, { level: 9 })),
		PNG_IEND,
	]);
};

const setPx = (pix: Uint8Array, x: number, y: number, idx: number) => {
	if ((x | y) < 0 || x >= 160 || y >= 60) return;
	pix[y * 160 + x] = idx;
};

/** Bresenham → 二次贝塞尔 */
const strokeCurve = (
	pix: Uint8Array,
	x0: number,
	y0: number,
	cx: number,
	cy: number,
	x1: number,
	y1: number,
) => {
	let px = x0;
	let py = y0;
	for (let i = 1; i <= 20; i++) {
		const t = i / 20;
		const u = 1 - t;
		const x = (u * u * x0 + 2 * u * t * cx + t * t * x1 + 0.5) | 0;
		const y = (u * u * y0 + 2 * u * t * cy + t * t * y1 + 0.5) | 0;
		let dx = x - px;
		let dy = y - py;
		const sx = dx < 0 ? -1 : 1;
		const sy = dy < 0 ? -1 : 1;
		dx = dx < 0 ? -dx : dx;
		dy = dy < 0 ? -dy : dy;
		let err = dx - dy;
		let ax = px;
		let ay = py;
		for (;;) {
			setPx(pix, ax, ay, 1);
			if (ax === x && ay === y) break;
			const e2 = err << 1;
			if (e2 > -dy) {
				err -= dy;
				ax += sx;
			}
			if (e2 < dx) {
				err += dx;
				ay += sy;
			}
		}
		px = x;
		py = y;
	}
};

/** 噪点 24×2 + 曲线 3×6 + 字 4×3 = 84；透明底索引图画布 */
const renderPngDataUrl = (code: string) => {
	const pix = new Uint8Array(9600);
	const r = randomBytes(84);
	let p = 0;
	const next = () => r[p++] ?? 0;

	for (let i = 0; i < 24; i++)
		setPx(pix, (next() * 160) >> 8, (next() * 60) >> 8, 1);

	for (let i = 0; i < 3; i++)
		strokeCurve(
			pix,
			4 + (next() & 31),
			4 + ((next() * 52) >> 8),
			50 + (next() & 63),
			(next() * 60) >> 8,
			130 + (next() & 31),
			4 + ((next() * 52) >> 8),
		);

	for (let i = 0; i < 4; i++) {
		const gi = CHAR_IDX[code.charCodeAt(i)] ?? -1;
		if (gi < 0) continue;
		const color = 2 + (next() & 7);
		const dx = 10 + i * 38;
		const dy = 12 + ((next() & 7) - 4);
		const shear = ((next() & 63) - 32) << 2;
		const base = gi * 1008;
		for (let y = 0; y < 36; y++) {
			const xOff = ((y - 18) * shear) >> 8;
			const py = dy + y;
			if (py < 0 || py >= 60) continue;
			const row = base + y * 28;
			const rowOut = py * 160;
			for (let x = 0; x < 28; x++) {
				if ((ATLAS[row + x] ?? 0) === 0) continue;
				const px = dx + x + xOff;
				if (px < 0 || px >= 160) continue;
				pix[rowOut + px] = color;
			}
		}
	}

	return `data:image/png;base64,${encodePng(pix).toString("base64")}`;
};

const sha256Hex = (data: string | Buffer) =>
	createHash("sha256").update(data).digest("hex");

const randomCode = () => {
	let s = "";
	for (const byte of randomBytes(4)) s += CHARSET[byte & 31];
	return s;
};

const safeEqualHex = (a: string, b: string) => {
	try {
		const ba = Buffer.from(a, "hex");
		const bb = Buffer.from(b, "hex");
		return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
	} catch {
		return false;
	}
};

/** 出票：索引色透明底 PNG + 答案哈希入库 */
export const createCaptcha = async () => {
	const captchaId = crypto.randomUUID();
	const code = randomCode();
	const answerHash = sha256Hex(code);
	const image = renderPngDataUrl(code);
	const exp = ((Date.now() / 1000) | 0) + 300;

	await sql`
		INSERT INTO captcha (id, answer_hash, expire_time)
		VALUES (
			${captchaId}::uuid,
			${answerHash},
			to_timestamp(${exp})
		)
	`;

	return { captchaId, image };
};

/**
 * 原子消费并校验答案。
 * 失败统一文案，不区分过期/错误/已用。
 */
export const consumeCaptcha = async (
	captchaId: string,
	captchaCode: string,
): Promise<void> => {
	const id = captchaId.trim();
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			id,
		)
	) {
		throw new AppError(400, "验证码错误或已过期");
	}

	const rows = await sql`
		DELETE FROM captcha
		WHERE id = ${id}::uuid
			AND expire_time > now()
		RETURNING answer_hash
	`;

	const answerHash = (rows[0] as { answer_hash?: string } | undefined)
		?.answer_hash;
	const codeHash = sha256Hex(captchaCode.trim().toUpperCase());

	if (!answerHash || !safeEqualHex(codeHash, answerHash)) {
		throw new AppError(400, "验证码错误或已过期");
	}

	void sql`
		DELETE FROM captcha
		WHERE id IN (
			SELECT id FROM captcha
			WHERE expire_time < now()
			LIMIT 50
		)
	`.catch(() => {});
};
