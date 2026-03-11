import type { StoredRunEvent } from "../runs/store/types.ts";

interface RunEventStreamBrokerOptions {
	keepAliveMs?: number;
	maxBufferedBytes?: number;
}

interface StreamSubscriber {
	enqueue: (chunk: Uint8Array) => boolean;
	close: () => void;
	closed: boolean;
}

const DEFAULT_KEEP_ALIVE_MS = 15_000;
const DEFAULT_MAX_BUFFERED_BYTES = 1024 * 1024;

export class RunEventStreamBroker {
	private readonly keepAliveMs: number;
	private readonly maxBufferedBytes: number;
	private readonly subscribers = new Map<string, Set<StreamSubscriber>>();
	private readonly textEncoder = new TextEncoder();

	constructor(options: RunEventStreamBrokerOptions = {}) {
		this.keepAliveMs = options.keepAliveMs ?? DEFAULT_KEEP_ALIVE_MS;
		this.maxBufferedBytes =
			options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
	}

	openStream(input: {
		runId: string;
		signal?: AbortSignal;
		resolveInitialEvents?: () => StoredRunEvent[];
	}) {
		let keepAliveTimer: Timer | null = null;
		let subscriber: StreamSubscriber | null = null;
		let abortHandler: (() => void) | null = null;

		const stream = new ReadableStream<Uint8Array>(
			{
				start: (controller) => {
					if (input.signal?.aborted) {
						controller.close();
						return;
					}

					const subscriberSet = this.getSubscriberSet(input.runId);
					subscriber = {
						enqueue: (chunk) => {
							const desiredSize = controller.desiredSize;
							if (desiredSize === null || desiredSize < chunk.byteLength) {
								subscriber?.close();
								this.unsubscribe(input.runId, subscriber, keepAliveTimer);
								return false;
							}

							controller.enqueue(chunk);
							return true;
						},
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

					abortHandler = () => {
						subscriber?.close();
						this.unsubscribe(
							input.runId,
							subscriber,
							keepAliveTimer,
							input.signal,
							abortHandler,
						);
					};
					input.signal?.addEventListener("abort", abortHandler, { once: true });

					try {
						for (const event of input.resolveInitialEvents?.() ?? []) {
							if (subscriber.closed) {
								return;
							}
							if (
								!subscriber.enqueue(this.textEncoder.encode(formatEvent(event)))
							) {
								return;
							}
						}
					} catch (error) {
						this.unsubscribe(
							input.runId,
							subscriber,
							keepAliveTimer,
							input.signal,
							abortHandler,
						);
						throw error;
					}

					if (subscriber.closed) {
						return;
					}

					keepAliveTimer = setInterval(() => {
						if (!subscriber || subscriber.closed) {
							return;
						}
						subscriber.enqueue(this.textEncoder.encode(": keepalive\n\n"));
					}, this.keepAliveMs);
				},
				cancel: () => {
					this.unsubscribe(
						input.runId,
						subscriber,
						keepAliveTimer,
						input.signal,
						abortHandler,
					);
				},
			},
			{
				highWaterMark: this.maxBufferedBytes,
				size: (chunk) => chunk?.byteLength ?? 0,
			},
		);

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
		signal?: AbortSignal,
		abortHandler?: (() => void) | null,
	) {
		if (keepAliveTimer) {
			clearInterval(keepAliveTimer);
		}
		if (signal && abortHandler) {
			signal.removeEventListener("abort", abortHandler);
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
