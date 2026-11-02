import { DurableObject } from "cloudflare:workers";
import { Type } from "@sinclair/typebox";
import { Workspace } from "@cloudflare/computer";
import { createPiTools } from "@cloudflare/computer/tools/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness, type ToolRegistration } from "@earendil-works/pi-durable";
import { PiHarness } from "agents/harness/pi";
import { Lifecycle } from "agents/lifecycle";
import { createAI } from "agents/models/pi-ai";
import { routeAgentRequest } from "agents/routing";
import { WebSockets } from "agents/websockets";

// 自作ツール: 文字列の単語数を数える
const WordCount = Type.Object({ text: Type.String() });
const wordCount: ToolRegistration<typeof WordCount> = {
	name: "word_count",
	description: "Count the words in a text.",
	parameters: WordCount,
	replay: "safe",
	async execute({ text }) {
		const words = text.split(/\s+/).filter(Boolean).length;
		return { output: [{ type: "text", text: String(words) }] };
	},
};

export class Assistant extends DurableObject<Env> {
	readonly ai = createAI({ binding: this.env.AI });
	readonly registry = createRegistry();

	// Tools: a durable filesystem in the object's SQLite database
	readonly workspace = new Workspace({ storage: this.ctx.storage });

	// Harness: the Pi agent loop, with the workspace as its tools
	readonly harness = new PiHarness({
		harness: ({ storage, context, onWake }) => {
			const { tools, execute } = createPiTools({ workspace: this.workspace });
			this.registry.install({
				name: "workspace",
				tools: tools.map((tool) => ({
					...tool,
					async execute(args, api, ctx) {
						const { content, isError } = await execute(
							{ id: api.callId, name: tool.name, arguments: args },
							{ abortSignal: ctx.abortSignal },
						);
						return { output: content, isError };
					},
				})),
			});
			this.registry.install({
				name: "editor",
				sections: [{ key: "preamble", render: () => "You are a terse assistant. Answer in one line.", tag: false }],
				tools: [wordCount],
			});
			const models = createModels();
			models.setProvider(this.ai.provider);
			return Harness.open(
				storage,
				{ models, registry: this.registry, onWake },
				context,
			);
		},
		defaults: { model: this.ai("@cf/zai-org/glm-4.7-flash") },
	});

	// Capability: clients send prompts and get replies over WebSockets
	readonly webSockets = new WebSockets({
		handlers: {
			onMessage: async (connection, message) => {
				const { text } = await this.harness.prompt(String(message));
				connection.send(text ?? "");
			},
		},
	});

	// Runtime: the Lifecycle starts the harness and the capabilities, and
	// handles the object's fetch, alarm, and WebSocket events
	readonly lifecycle = Lifecycle.install(this)
		.use(this.harness)
		.use(this.webSockets);

	async onRequest(request: Request): Promise<Response> {
		if (request.method !== "POST") {
			return Response.json(await this.harness.messages());
		}
		const { status, text, reason } = await this.harness.prompt(await request.text());
		return Response.json({ status, text, reason });
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
