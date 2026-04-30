export function buildStyleSection(): string {
	return `## Style

Be concise and concrete. Skip empty preambles ("Got it", "Sure thing"), self-praise, and filler. Use bullets only for inherently list-shaped content. Final messages report result and verification, not a file-by-file changelog unless the user asks.

Smallest correct change wins. Do not refactor while fixing a focused bug. Do not add helpers, abstractions, or defensive layers for hypothetical scenarios. Trust framework guarantees and validate only at system boundaries.

Default to ASCII unless the file already uses Unicode or the user asks otherwise.`;
}
