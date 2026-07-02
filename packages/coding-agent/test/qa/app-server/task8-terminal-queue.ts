import {
	NotificationRouter,
	type RoutableConnection,
	type RoutableThread,
	type RouterNotification,
} from "../../../src/modes/app-server/server/notifications.ts";

class FakeConnection implements RoutableConnection {
	readonly id = "C";
	readonly transport = "ws";
	readonly initialized = true;
	readonly received: RouterNotification[] = [];

	send(notification: RouterNotification): void {
		this.received.push(notification);
	}
}

const thread: RoutableThread = {
	id: "t1",
	subscribers: new Set<string>(),
	queuedTerminalNotifications: [],
};
const c = new FakeConnection();
const router = new NotificationRouter({ connections: [c], threads: [thread] });

router.toThread("t1", { method: "turn/completed", params: { threadId: "t1", turn: { id: "turn-1" } } });
router.subscribe("t1", "C");

const firstMethod = c.received[0]?.method ?? "NONE";
console.log(`C_FIRST=${firstMethod}`);
if (firstMethod !== "turn/completed") {
	process.exitCode = 1;
}
