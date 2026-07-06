export function readSecretQuestionIds(params: unknown): ReadonlySet<string> {
	const questions = isRecord(params) && Array.isArray(params.questions) ? params.questions : [];
	const ids = questions.flatMap((question) => {
		if (!isRecord(question) || (question.isSecret !== true && question.is_secret !== true)) {
			return [];
		}
		const id = readString(question, "id");
		return id ? [id] : [];
	});
	return new Set(ids);
}

export function redactSecretAnswers(response: unknown, secretQuestionIds: ReadonlySet<string>): unknown {
	if (secretQuestionIds.size === 0 || !isRecord(response) || !isRecord(response.answers)) {
		return response;
	}
	const redactedAnswers: Record<string, unknown> = {};
	for (const [questionId, answer] of Object.entries(response.answers)) {
		redactedAnswers[questionId] = secretQuestionIds.has(questionId) ? redactAnswer(answer) : answer;
	}
	return { ...response, answers: redactedAnswers };
}

function redactAnswer(answer: unknown): unknown {
	return isRecord(answer) && Array.isArray(answer.answers)
		? { ...answer, answers: answer.answers.map(() => "[REDACTED]") }
		: answer;
}

function readString(input: Readonly<Record<string, unknown>>, key: string): string | undefined {
	const value = input[key];
	return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
