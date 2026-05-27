export interface InitAnswers {
	input: string;
	output: string;
	adapter: "axios" | "fetch";
	noZod: boolean;
	splitServices: boolean;
	plugins: string[];
}

export interface InitConfig {
	input: string;
	output: string;
	httpAdapter: "axios" | "fetch";
	noZod: boolean;
	splitServices: boolean;
	plugins: string[];
}

export function buildInitConfig(answers: InitAnswers): InitConfig {
	return {
		input: answers.input,
		output: answers.output,
		httpAdapter: answers.adapter,
		noZod: answers.noZod,
		splitServices: answers.splitServices,
		plugins: answers.plugins,
	};
}
