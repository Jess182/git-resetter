import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { basename, join } from "node:path";

const COMMAND = "git";
const VERSION = "2.0.0";

interface GitOutput {
	code: number;
	stdout: string;
	stderr: string;
}

interface Entry {
	project: string;
	branch: string;
	runHash: string;
	hash: string;
	message: string;
}

function git(args: string[]): GitOutput {
	const result = spawnSync(COMMAND, args, { encoding: "utf8" });

	return {
		code: result.status ?? 1,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

function checkOutput(output: GitOutput, message: string): void {
	if (output.code !== 0) {
		console.error(message);
		process.exit(1);
	}
}

function areThereChanges(): boolean {
	return git(["status", "--porcelain"]).stdout.trim().length > 0;
}

function getBranchName(): string {
	return git(["branch", "--show-current"]).stdout.trim();
}

function confirmPrompt(message: string): boolean {
	process.stdout.write(`${message} [y/N] `);

	const buffer = new Uint8Array(256);
	let bytes = 0;

	try {
		bytes = readSync(0, buffer, 0, buffer.length, null);
	} catch {
		return false;
	}

	const answer = new TextDecoder().decode(buffer.subarray(0, bytes)).trim();

	return answer.toLowerCase() === "y";
}

// --- JSON storage -----------------------------------------------------------

function getDataDir(): string {
	if (platform() === "darwin") {
		return join(homedir(), "Library", "Application Support", "git-resetter");
	}
	return join(
		process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
		"git-resetter",
	);
}

const DATA_DIR = getDataDir();
const DB_FILE = join(DATA_DIR, "db.json");

function loadDb(): Entry[] {
	if (!existsSync(DB_FILE)) return [];
	return JSON.parse(readFileSync(DB_FILE, "utf8")) as Entry[];
}

function saveDb(entries: Entry[]): void {
	mkdirSync(DATA_DIR, { recursive: true });
	writeFileSync(DB_FILE, JSON.stringify(entries, null, "\t"));
}

const PROJECT = basename(process.cwd());
const BRANCH = getBranchName();

function belongsToRun(entry: Entry, runHash: string): boolean {
	return entry.project === PROJECT && entry.branch === BRANCH &&
		entry.runHash === runHash;
}

// --- Commands ---------------------------------------------------------------

function deleteDBHash(hash: string): void {
	const entries = loadDb();
	const kept = entries.filter((e) => !belongsToRun(e, hash));

	saveDb(kept);

	console.info(`Deleted hash ${hash}: ${entries.length - kept.length} entries`);
}

function restore(hash: string, skip: boolean): void {
	let db = loadDb();
	const entries = db.filter((e) => belongsToRun(e, hash)).reverse();

	let count = 0;

	for (const entry of entries) {
		const h = entry.hash;
		const message = entry.message;
		let output: GitOutput;

		const avoidSkip = !skip || count > 0; // Skip when flag is set and it's the first element on loop

		if (hash !== h && avoidSkip) {
			console.info(`Restoring ${h} commit: ${message}`);

			output = git(["stash", "apply", `stash^{/${h}}`]);
			checkOutput(output, `Failed to restore changes: ${output.stdout}`);
		}

		if (areThereChanges()) {
			output = git(["add", "."]);
			checkOutput(
				output,
				`Failed to add changes to stage area: ${output.stderr}`,
			);

			console.info(`Committing ${h} commit: ${message}`);

			output = git(["commit", "--no-verify", "-m", message]);
			checkOutput(output, `Failed to commit changes: ${output.stderr}`);
		}

		if (hash !== h) {
			output = git(["stash", "drop", "stash@{0}"]);
			checkOutput(output, `Failed to drop stash: ${output.stderr}`);
		}

		db = db.filter((e) => e !== entry);
		saveDb(db); // Persist per step so a failure keeps pending entries

		skip = false;
		count++;
	}

	console.info("Restoration completed.");
}

function softReset(hash: string): void {
	if (
		areThereChanges() &&
		!confirmPrompt(
			"There are changes in the working directory. Do you want to continue?",
		)
	) {
		process.exit(0);
	}

	const lines = git(["log", "--pretty=%H---%s"]).stdout.trim().split("\n");
	const db = loadDb();

	for (const line of lines) {
		const sep = line.indexOf("---");
		const commitHash = line.slice(0, sep);
		const message = line.slice(sep + 3).trim();

		git(["reset", "--soft", `${commitHash}~1`]);

		if (areThereChanges() && hash !== commitHash) {
			console.info(`Stashing commit: ${commitHash} - ${message}`);
			git(["stash", "push", "-u", "-m", commitHash]);
		}

		db.push({ project: PROJECT, branch: BRANCH, runHash: hash, hash: commitHash, message });
		saveDb(db);

		if (commitHash === hash) break;
	}

	console.info("Soft reset completed.");
}

// --- CLI (manual parsing, no dependencies) ----------------------------------

const HELP = `gitr ${VERSION}
CLI tool to soft reset and restore commits.

Usage:
  gitr reset <hash>              Soft reset to a specific commit hash and stash changes.
  gitr restore <hash> [-s]       Restore stashed commits with their messages.
  gitr delete-db-hash|dh <hash>  Delete DB hash entries.

Options:
  -s, --skip     Skip flag (restore).
  -h, --help     Show help.
  -V, --version  Show version.`;

function main(): void {
	const args = process.argv.slice(2);
	const positionals: string[] = [];
	let skip = false;

	for (const arg of args) {
		if (arg === "-s" || arg === "--skip") skip = true;
		else if (arg === "-h" || arg === "--help") return console.info(HELP);
		else if (arg === "-V" || arg === "--version") return console.info(VERSION);
		else if (arg.startsWith("-")) {
			console.error(`Unknown option: ${arg}\n\n${HELP}`);
			process.exit(1);
		} else positionals.push(arg);
	}

	// scriptc aborts on out-of-bounds index access (no `undefined`), so check length first
	if (positionals.length === 0) return console.info(HELP);

	if (positionals.length < 2) {
		console.error(`Missing <hash> argument.\n\n${HELP}`);
		process.exit(1);
	}

	const command = positionals[0];
	const hash = positionals[1];

	if (command === "reset") softReset(hash);
	else if (command === "restore") restore(hash, skip);
	else if (command === "delete-db-hash" || command === "dh") deleteDBHash(hash);
	else {
		console.error(`Unknown command: ${command}\n\n${HELP}`);
		process.exit(1);
	}
}

main();

