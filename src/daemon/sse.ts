import type { StoredRunEvent } from "../runs/store/types.ts";

interface RunEventStreamBrokerOptions {
	keepAliveMs?: number;
}

interface StreamSubscriber {
	enqueue: (chunk: Uint8Array) => void;
	close: () => void;
	closed: boolean;
}

const DEFAULT_KEEP_ALIVE_MS = 15_000;

export class RunEventStreamBroker {
	private readonly keepAliveMs: number;
	private readonly subscribers = new Map<string, Set<StreamSubscriber>>();
	private readonly textEncoder = new TextEncoder();

	constructor(options: RunEventStreamBrokerOptions = {}) {
		this.keepAliveMs = options.keepAliveMs ?? DEFAULT_KEEP_ALIVE_MS;
	}

	openStream(runId: string, signal?: AbortSignal) {
		let keepAliveTimer: Timer | null = null;
		let subscriber: StreamSubscriber | null = null;

		const stream = new ReadableStream<Uint8Array>({
			start: (controller) => {
				if (signal?.aborted) {
					controller.close();
					return;
				}

				const subscriberSet = this.getSubscriberSet(runId);
				subscriber = {
					enqueue: (chunk) => controller.enqueue(chunk),
					close: () => {
						if (!subscriber || subscriber.closed) {
							return;
						}
						subscriber.closed = true;
						controller.close();
					},
					closed: false,
				};

				subscriberSet.add(subscriber);
				keepAliveTimer = setInterval(() => {
					if (!subscriber || subscriber.closed) {
						return;
					}
					controller.enqueue(this.textEncoder.encode(": keepalive\n\n"));
				}, this.keepAliveMs);

				signal?.addEventListener(
					"abort",
					() => {
						subscriber?.close();
						this.unsubscribe(runId, subscriber, keepAliveTimer);
					},
					{ once: true },
				);
			},
			cancel: () => {
				this.unsubscribe(runId, subscriber, keepAliveTimer);
			},
		});

		return new Response(stream, {
			status: 200,
			headers: {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache",
				connection: "keep-alive",
				"x-accel-buffering": "no",
			},
		});
	}

	publish(runId: string, events: StoredRunEvent[]) {
		const subscribers = this.subscribers.get(runId);
		if (!subscribers || subscribers.size === 0) {
			return;
		}

		for (const event of events) {
			const payload = this.textEncoder.encode(formatEvent(event));
			for (const subscriber of subscribers) {
				if (subscriber.closed) {
					continue;
				}
				subscriber.enqueue(payload);
			}
		}
	}

	subscriberCount(runId: string) {
		return this.subscribers.get(runId)?.size ?? 0;
	}

	private getSubscriberSet(runId: string) {
		let subscribers = this.subscribers.get(runId);
		if (!subscribers) {
			subscribers = new Set();
			this.subscribers.set(runId, subscribers);
		}
		return subscribers;
	}

	private unsubscribe(
		runId: string,
		subscriber: StreamSubscriber | null,
		keepAliveTimer: Timer | null,
	) {
		if (keepAliveTimer) {
			clearInterval(keepAliveTimer);
		}
		if (!subscriber) {
			return;
		}
		subscriber.closed = true;
		const subscribers = this.subscribers.get(runId);
		if (!subscribers) {
			return;
		}
		subscribers.delete(subscriber);
		if (subscribers.size === 0) {
			this.subscribers.delete(runId);
		}
	}
}

function formatEvent(event: StoredRunEvent) {
	return `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(
		event,
	)}\n\n`;
}
