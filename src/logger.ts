import pc from "picocolors";

export interface ILogger {
	info(msg: string): void;
	success(msg: string): void;
	warn(msg: string): void;
	error(msg: string): void;
	log(msg: string): void;
	watch(msg: string): void;
	dim(msg: string): void;
}

export const logger: ILogger = {
	info: (msg: string) => console.log(`${pc.cyan("ℹ")} ${msg}`),
	success: (msg: string) => console.log(`${pc.green("✔")} ${pc.green(msg)}`),
	warn: (msg: string) => console.warn(`${pc.yellow("⚠")} ${pc.yellow(msg)}`),
	error: (msg: string) => console.error(`${pc.red("✖")} ${pc.red(msg)}`),
	log: (msg: string) => console.log(msg),
	watch: (msg: string) => console.log(`${pc.magenta("◉")} ${pc.magenta(msg)}`),
	dim: (msg: string) => console.log(pc.dim(msg)),
};
