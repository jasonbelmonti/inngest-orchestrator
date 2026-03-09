#!/usr/bin/env bun
import { stdin } from "node:process";
import { runCli } from "./cli/app.ts";

const args = Bun.argv.slice(2);
const needsStdin =
	args[0] === "workflow" && (args[1] === "validate" || args[1] === "save");
const stdinText = needsStdin ? await readStdinText() : undefined;
const result = await runCli(args, { stdinText });

if (result.stdout.length > 0) {
	process.stdout.write(result.stdout);
}

if (result.stderr.length > 0) {
	process.stderr.write(result.stderr);
}

process.exit(result.exitCode);

async function readStdinText() {
	let result = "";
	stdin.setEncoding("utf8");
	for await (const chunk of stdin) {
		result += chunk;
	}
	return result;
}
