import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("Counter agent", () => {
	it("starts at 0 and increments per name", async () => {
		const first = await SELF.fetch("https://example.com/agents/counter/alice");
		expect(await first.json()).toEqual({ count: 0 });

		await SELF.fetch("https://example.com/agents/counter/alice/inc", { method: "POST" });
		const second = await SELF.fetch("https://example.com/agents/counter/alice/inc", { method: "POST" });
		expect(await second.json()).toEqual({ count: 2 });

		// 別の名前は別のインスタンス
		const other = await SELF.fetch("https://example.com/agents/counter/bob");
		expect(await other.json()).toEqual({ count: 0 });
	});

	it("registers a delayed schedule", async () => {
		const res = await SELF.fetch("https://example.com/agents/counter/carol/reset-later?in=60", { method: "POST" });
		expect(res.status).toBe(201);
		const schedule = (await res.json()) as { type: string; callback: string; delayInSeconds: number };
		expect(schedule.type).toBe("delayed");
		expect(schedule.callback).toBe("reset");
		expect(schedule.delayInSeconds).toBe(60);

		const list = (await (await SELF.fetch("https://example.com/agents/counter/carol/schedules")).json()) as unknown[];
		expect(list).toHaveLength(1);
	});

	it("returns 404 outside /agents", async () => {
		const res = await SELF.fetch("https://example.com/");
		expect(res.status).toBe(404);
	});
});
