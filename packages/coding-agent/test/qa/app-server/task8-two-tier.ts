import {
	NotificationRouter,
	type RoutableConnection,
	type RoutableThread,
	type RouterNotification,
} from "../../../src/modes/app-server/server/notifications.ts";

class FakeConnection implements RoutableConnection {
	readonly id: string;
	readonly transport = "ws";
	readonly initialized = true;
	readonly received: RouterNotification[] = [];

	constructor(id: string) {
		this.id = id;
	}

	send(notification: RouterNotification): void {
		this.received.push(notification);
	}
}

const thread: RoutableThread = {
	id: "t1",
	subscribers: new Set(["A"]),
	queuedTerminalNotifications: [],
};
const a = new FakeConnection("A");
const b = new FakeConnection("B");
const router = new NotificationRouter({ connections: [a, b], threads: [thread] });

router.broadcast({ method: "thread/started", params: { thread: { id: "t1" } } });
router.toThread("t1", { method: "turn/started", params: { threadId: "t1", turn: { id: "turn-1" } } });

const bMethods = b.received.map((notification) => notification.method).join(",");
console.log(`B_GOT=${bMethods}`);
if (bMethods !== "thread/started") {
	process.exitCode = 1;
}
