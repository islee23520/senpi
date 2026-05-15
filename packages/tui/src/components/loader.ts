import type { TUI } from "../tui.js";
import { Text } from "./text.js";

export type LoaderMessageFormatter = (message: string, frameIndex: number) => string;

export interface LoaderIndicatorOptions {
	/** Animation frames. Use an empty array to hide the indicator. */
	frames?: string[];
	/** Frame interval in milliseconds for animated indicators. */
	intervalMs?: number;
	/** Optional message formatter called on each message animation frame. */
	messageFormatter?: LoaderMessageFormatter;
	/** Frame interval in milliseconds for message animation. Defaults to intervalMs. */
	messageIntervalMs?: number;
}

const DEFAULT_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const DEFAULT_INTERVAL_MS = 80;

/**
 * Loader component that updates with an optional spinning animation.
 */
export class Loader extends Text {
	private frames = [...DEFAULT_FRAMES];
	private intervalMs = DEFAULT_INTERVAL_MS;
	private currentFrame = 0;
	private currentMessageFrame = 0;
	private indicatorIntervalId: NodeJS.Timeout | null = null;
	private messageIntervalId: NodeJS.Timeout | null = null;
	private messageFormatter: LoaderMessageFormatter | undefined = undefined;
	private messageIntervalMs = DEFAULT_INTERVAL_MS;
	private ui: TUI | null = null;
	private renderIndicatorVerbatim = false;

	constructor(
		ui: TUI,
		private spinnerColorFn: (str: string) => string,
		private messageColorFn: (str: string) => string,
		private message: string = "Loading...",
		indicator?: LoaderIndicatorOptions,
	) {
		super("", 1, 0);
		this.ui = ui;
		this.setIndicator(indicator);
	}

	render(width: number): string[] {
		return ["", ...super.render(width)];
	}

	start(): void {
		this.updateDisplay();
		this.restartAnimation();
	}

	stop(): void {
		if (this.indicatorIntervalId) {
			clearInterval(this.indicatorIntervalId);
			this.indicatorIntervalId = null;
		}
		if (this.messageIntervalId) {
			clearInterval(this.messageIntervalId);
			this.messageIntervalId = null;
		}
	}

	setMessage(message: string): void {
		this.message = message;
		this.updateDisplay();
	}

	setIndicator(indicator?: LoaderIndicatorOptions): void {
		this.renderIndicatorVerbatim = indicator !== undefined;
		this.frames = indicator?.frames !== undefined ? [...indicator.frames] : [...DEFAULT_FRAMES];
		this.intervalMs = indicator?.intervalMs && indicator.intervalMs > 0 ? indicator.intervalMs : DEFAULT_INTERVAL_MS;
		this.messageFormatter = indicator?.messageFormatter;
		this.messageIntervalMs =
			indicator?.messageIntervalMs && indicator.messageIntervalMs > 0
				? indicator.messageIntervalMs
				: this.intervalMs;
		this.currentFrame = 0;
		this.currentMessageFrame = 0;
		this.start();
	}

	private restartAnimation(): void {
		this.stop();
		if (this.frames.length > 1) {
			this.indicatorIntervalId = setInterval(() => {
				this.currentFrame = (this.currentFrame + 1) % this.frames.length;
				this.updateDisplay();
			}, this.intervalMs);
		}
		if (this.messageFormatter) {
			this.messageIntervalId = setInterval(() => {
				this.currentMessageFrame += 1;
				this.updateDisplay();
			}, this.messageIntervalMs);
		}
	}

	private updateDisplay(): void {
		const frame = this.frames[this.currentFrame] ?? "";
		const renderedFrame = this.renderIndicatorVerbatim ? frame : this.spinnerColorFn(frame);
		const indicator = frame.length > 0 ? `${renderedFrame} ` : "";
		const renderedMessage = this.messageFormatter
			? this.messageFormatter(this.message, this.currentMessageFrame)
			: this.messageColorFn(this.message);
		this.setText(`${indicator}${renderedMessage}`);
		if (this.ui) {
			this.ui.requestRender();
		}
	}
}
