import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createBashTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Text } from "@earendil-works/pi-tui";
import fs from "node:fs";
import path from "node:path";

// ── Constants ─────────────────────────────────────────────────────────────────

const BASH_DIR_NAME = ".pi/bash";
const VALID_NAME_RE = /^[a-z0-9_-]+$/;
const DEFAULT_TIMEOUT = 120;
const MAX_DESC_LINES = 10;

// ── Parameter Schema ──────────────────────────────────────────────────────────

const SCRIPT_PARAMS = Type.Object({
	args: Type.Optional(
		Type.String({ description: "Additional arguments to pass to the script" }),
	),
});

// ── Metadata Helpers ──────────────────────────────────────────────────────────

function extractDescription(filePath: string): string {
	const name = path.basename(filePath, ".sh");
	try {
		const lines = fs.readFileSync(filePath, "utf-8").split("\n").slice(0, MAX_DESC_LINES);
		for (const line of lines) {
			const trimmed = line.trim();
			// Check for explicit description comment
			const descMatch = trimmed.match(/^#\s*Description:\s*(.+)$/i);
			if (descMatch) return descMatch[1].trim();
			// Skip shebang
			if (trimmed.startsWith("#!")) continue;
			// Take first non-empty, non-shebang comment as description
			if (trimmed.startsWith("#")) return trimmed.slice(1).trim();
			// First non-comment, non-empty line
			if (trimmed.length > 0) return `Run the ${name} script`;
		}
	} catch {
		// File unreadable — fall through
	}
	return `Run the ${name} script`;
}

function extractTimeout(filePath: string): number {
	try {
		const content = fs.readFileSync(filePath, "utf-8");
		const match = content.match(/^#\s*timeout:\s*(\d+)/m);
		if (match) return Math.max(1, parseInt(match[1], 10));
	} catch {
		// File unreadable — fall through
	}
	return DEFAULT_TIMEOUT;
}

function camelCaseLabel(filename: string): string {
	const name = path.basename(filename, ".sh");
	// Split on underscores, dashes, or spaces; capitalize each part
	return name
		.split(/[-_\s]+/)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join("");
}

// ── Discovery & Registration ─────────────────────────────────────────────────

function discoverAndRegisterScripts(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	toolNames: Set<string>,
): number {
	const bashDir = path.join(ctx.cwd, BASH_DIR_NAME);

	if (!fs.existsSync(bashDir)) {
		return 0;
	}

	const entries = fs.readdirSync(bashDir, { withFileTypes: true });
	const scripts: Array<{ name: string; filePath: string; timeout: number }> = [];

	for (const entry of entries) {
		if (!entry.isFile()) continue;
		if (!entry.name.endsWith(".sh")) continue;
		if (entry.name.startsWith(".")) continue;

		const name = entry.name.slice(0, -3); // strip .sh
		if (!VALID_NAME_RE.test(name)) continue;

		const filePath = path.join(bashDir, entry.name);
		const timeout = extractTimeout(filePath);
		scripts.push({ name, filePath, timeout });
	}

	let count = 0;

	// Register each script as a tool
	for (const { name, filePath, timeout } of scripts) {
		toolNames.add(name);
		count++;

		const description = extractDescription(filePath);
		const label = camelCaseLabel(filePath);

		pi.registerTool({
			name,
			label,
			description,
			promptSnippet: `Run the ${name} script`,
			parameters: SCRIPT_PARAMS,
			renderCall: (params, theme) => {
				const prefix = theme.fg("toolTitle", theme.bold(label + " "));
				if (params.args) {
					return new Text(prefix + theme.fg("accent", params.args), 0, 0);
				}
				return new Text(prefix + theme.fg("dim", "(no arguments)"), 0, 0);
			},
			execute: async (toolCallId, params, signal, onUpdate, execCtx) => {
				// Verify script still exists
				if (!fs.existsSync(filePath)) {
					return {
						content: [
							{
								type: "text",
								text: `Error: script not found at ${filePath}. It may have been deleted.`,
							},
						],
						isError: true,
						details: { error: "script_not_found" },
					};
				}

				const command = params.args
					? `bash "${filePath}" ${params.args}`
					: `bash "${filePath}"`;

				// Delegate to the bash tool for execution
				const bashTool = createBashTool(execCtx.cwd);
				return bashTool.execute(
					toolCallId,
					{ command, timeout },
					signal,
					onUpdate,
				);
			},
		});
	}

	return count;
}

// ── Extension Factory ─────────────────────────────────────────────────────────

export default function shellScriptsExtension(pi: ExtensionAPI) {
	// Track registered tool names to avoid duplicates on reload
	const registeredToolNames = new Set<string>();

	// Handle session start — discover and register scripts
	pi.on("session_start", (_event, ctx) => {
		const reason = _event.reason;

		// On reload, clear old registrations and re-discover
		if (reason === "reload") {
			registeredToolNames.clear();
		}

		const count = discoverAndRegisterScripts(pi, ctx, registeredToolNames);
		if (count > 0) {
			ctx.ui.notify(`Registered ${count} script tool(s) from .pi/bash/`, "info");
		}
	});

	// Handle resources_discover with reload reason
	pi.on("resources_discover", (event, ctx) => {
		if (event.reason === "reload") {
			registeredToolNames.clear();
			discoverAndRegisterScripts(pi, ctx, registeredToolNames);
		}
	});

	// Register /reload-scripts command
	pi.registerCommand("reload-scripts", {
		description: "Re-scan .pi/bash/ and (re)register all script tools",
		handler: async (_args, ctx) => {
			registeredToolNames.clear();
			const count = discoverAndRegisterScripts(pi, ctx, registeredToolNames);
			if (count > 0) {
				ctx.ui.notify(`Script tools refreshed (${count} registered)`, "info");
			} else {
				ctx.ui.notify("No scripts found in .pi/bash/", "info");
			}
		},
	});
}
