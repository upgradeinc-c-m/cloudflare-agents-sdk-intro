import { DurableObject } from "cloudflare:workers";
import { Lifecycle } from "agents/lifecycle";
import { routeAgentRequest } from "agents/routing";
import { Scheduler } from "agents/schedules";
import { State } from "agents/state";
import { WebSockets } from "agents/websockets";

type CounterState = { count: number; lastReset?: string };

export class Counter extends DurableObject<Env> {
	// State: 1 つの JSON 値を SQLite に保存し、接続中のクライアントへ同期する
	readonly state: State<CounterState> = new State<CounterState>({
		initialState: { count: 0 },
		validateStateChange: (next) => {
			if (next.count < 0) throw new Error("count must be >= 0");
		},
		onChanged: (_state, source) => this.webSockets.broadcastState(source),
	});

	// Scheduler: 名前付きコールバックを後で実行する(アラームは Lifecycle が 1 つに束ねる)
	readonly scheduler = new Scheduler({
		callbacks: {
			reset: (payload: { reason: string }) => {
				this.state.set({ count: 0, lastReset: `${new Date().toISOString()} (${payload.reason})` });
				for (const c of this.webSockets.getConnections()) c.send(`reset: ${payload.reason}`);
			},
		},
	});

	// WebSockets: 接続を受け付け、state を同期する
	readonly webSockets: WebSockets = new WebSockets({
		state: this.state,
		handlers: {
			onConnect: (connection) => connection.send(`hello ${connection.id}`),
			onMessage: (connection, message) => {
				if (message === "inc") {
					const cur = this.state.get() ?? { count: 0 };
					this.state.set({ ...cur, count: cur.count + 1 });
					connection.send(`count=${this.state.get()?.count}`);
				}
			},
		},
	});

	readonly lifecycle = Lifecycle.install(this)
		.use(this.state)
		.use(this.scheduler)
		.use(this.webSockets);

	async onStart() {
		console.log(`Counter "${this.lifecycle.name}" started`);
	}

	async onRequest(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (request.method === "POST" && url.pathname.endsWith("/inc")) {
			const cur = this.state.get() ?? { count: 0 };
			this.state.set({ ...cur, count: cur.count + 1 });
			return Response.json(this.state.get());
		}
		if (request.method === "POST" && url.pathname.endsWith("/reset-later")) {
			const seconds = Number(url.searchParams.get("in") ?? "10");
			const schedule = await this.scheduler.set(seconds, "reset", { reason: `scheduled ${seconds}s` });
			return Response.json(schedule, { status: 201 });
		}
		if (url.pathname.endsWith("/schedules")) {
			return Response.json(await this.scheduler.list());
		}
		return Response.json(this.state.get());
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		return (
			(await routeAgentRequest(request, env)) ??
			new Response("Not found", { status: 404 })
		);
	},
} satisfies ExportedHandler<Env>;
