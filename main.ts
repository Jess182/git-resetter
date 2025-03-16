// deno-lint-ignore-file no-var no-inner-declarations

const COMMAND = "git";

function areThereChanges(): boolean {
	const statusArgs = ["status", "--porcelain"];

	const process = new Deno.Command(COMMAND, {
		args: statusArgs,
	});

	const output = decodeOutput(process.outputSync().stdout);

	return output.trim().length > 0;
}

function checkOutput(output: Deno.CommandOutput, message: string): void {
	if (output.code !== 0) {
		console.error(message);
		Deno.exit(1);
	}
}

function decodeOutput(output: Uint8Array): string {
	return new TextDecoder().decode(output);
}

async function deleteDBHash(hash: string): Promise<void> {
	const entries = kv.list<Record<string, string>>({
		prefix: [...DB_KEY, hash],
	});

	let count = 0;

	for await (const entry of entries) {
		count++;
		await kv.delete(entry.key);
	}

	console.info(`Deleted hash ${hash}: ${count} entries`);
}

function getBranchName(): string {
	const branchArgs = ["branch", "--show-current"];

	const process = new Deno.Command(COMMAND, {
		args: branchArgs,
	});

	const output = decodeOutput(process.outputSync().stdout);

	return output.trim();
}

async function restore(hash: string, skip?: boolean): Promise<void> {
	const stashArgs = ["stash", "apply"];
	const addArgs = ["add", "."];
	const commitArgs = ["commit", "--no-verify", "-m"];
	const stashDropArgs = ["stash", "drop", "stash@{0}"];

	const entries = kv.list<Record<string, string>>({
		prefix: [...DB_KEY, hash],
	}, { reverse: true });

	let count = 0;

	for await (const entry of entries) {
		const h = entry.value.hash;
		const message = entry.value.message;

		let output: Deno.CommandOutput;

		const skipFlag = !skip || count; // Skip when flag is set and it's the first element on loop

		if (hash !== h && skipFlag) {
			console.info(`Restoring ${h} commit: ${message}`);

			output = new Deno.Command(COMMAND, {
				args: [...stashArgs, `stash^{/${h}}`],
			}).outputSync();

			checkOutput(
				output,
				`Failed to restore changes: ${decodeOutput(output.stderr)}`,
			);
		}

		if (areThereChanges()) {
			output = new Deno.Command(COMMAND, { args: addArgs }).outputSync();

			checkOutput(
				output,
				`Failed to add changes to stage area: ${decodeOutput(output.stderr)}`,
			);

			console.info(`Committing ${h} commit: ${message}`);

			output = new Deno.Command(COMMAND, {
				args: [...commitArgs, message],
			}).outputSync();

			checkOutput(
				output,
				`Failed to commit changes: ${decodeOutput(output.stderr)}`,
			);
		}

		if (hash !== h) {
			output = new Deno.Command(COMMAND, {
				args: stashDropArgs,
			}).outputSync();

			checkOutput(
				output,
				`Failed to drop stash: ${decodeOutput(output.stderr)}`,
			);
		}

		await kv.delete(entry.key);

		skip = false;

		count++;
	}

	console.info("Restoration completed.");
}

async function softReset(hash: string): Promise<void> {
	const logArgs = ["log", "--pretty=%H---%s"];
	const stashArgs = ["stash", "push", "-u", "-m"];
	const resetArgs = ["reset", "--soft"];

	if (
		areThereChanges() &&
		!confirm(
			"There are changes in the working directory. Do you want to continue? (y/n): ",
		)
	) {
		Deno.exit(0);
	}

	const process = new Deno.Command(COMMAND, {
		args: logArgs,
	});

	const output = decodeOutput(process.outputSync().stdout);

	const commits = output
		.trim()
		.split("\n")
		.map((line) => {
			const [commitHash, message] = line.split("---");
			return { hash: commitHash, message: message.trim() };
		});

	for (const commit of commits) {
		new Deno.Command(COMMAND, {
			args: [...resetArgs, `${commit.hash}~1`],
		}).outputSync();

		if (areThereChanges() && hash !== commit.hash) {
			console.info(`Stashing commit: ${commit.hash} - ${commit.message}`);

			new Deno.Command(COMMAND, {
				args: [...stashArgs, commit.hash],
			}).outputSync();
		}

		await kv.set([...DB_KEY, hash, Date.now()], commit); // Use hash as key to group commits from a run

		if (commit.hash === hash) break;
	}

	console.info(`Soft reset completed.`);
}

if (import.meta.main) {
	const PROJECT_NAME = Deno.cwd().split("/").pop()!;

	var DB_KEY = ["git-resetter", PROJECT_NAME, getBranchName()];

	var kv = await Deno.openKv();

	const { Command } = await import("jsr:@cliffy/command@1.0.0-rc.7");

	await new Command()
		.name("git-resetter")
		.version("1.0.0")
		.description("CLI tool to soft reset and restore commits.")
		.command(
			"reset <hash:string>",
			"Soft reset to a specific commit hash and stash changes.",
		)
		.action((_, hash) => softReset(hash))
		.command(
			"restore <hash:string>",
			"Restore stashed commits with their messages.",
		)
		.option("-s, --skip", "Skip flag.")
		.action((options, hash) => restore(hash, options.skip))
		.command(
			"delete-db-hash <hash:string>",
			"Delete DB hash entries.",
		)
		.alias("dh")
		.action((_, hash) => deleteDBHash(hash))
		.parse(Deno.args)
		.catch((error) => {
			console.error("An error occurred while executing CLI:");
			console.error(error);
			Deno.exit(1);
		})
		.finally(() => {
			kv.close();
		});
}
