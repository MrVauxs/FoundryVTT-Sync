/* eslint-disable no-console */
import chalk from "chalk";
function prepend(s = "foundryvtt-sync") {
    return chalk.hex("#FFA500")(`[${s}]`);
}
export function log(m) {
    if (typeof m === "function")
        m = m();
    console.log(`${prepend()} ${m}`);
}
//# sourceMappingURL=logs.js.map