/* eslint-disable no-console */
import chalk from "chalk";

function prepend(s: string = "foundryvtt-sync") {
	return chalk.hex("#FFA500")(`[${s}]`);
}

export function log(m: string | (() => string)): void {
	if (typeof m === "function") m = m();
	console.log(`${prepend()} ${m}`);
}
