export const WORKFLOW_CONFIG_ROOT_ENV = "AGENT_ORCHESTRATOR_CONFIG_ROOT";
export const WORKFLOWS_DIRECTORY_NAME = "workflows";
export const REPOSITORIES_DIRECTORY_NAME = "repos";
export const REPOSITORY_CATALOG_FILE_NAME = "workspace.repos.json";

export const REPO_TARGET_NODE_KINDS = ["task", "check", "artifact"] as const;

export const SUPPORTED_WORKFLOW_NODE_KINDS = [
	"trigger",
	"task",
	"check",
	"gate",
	"artifact",
	"terminal",
] as const;

export const SUPPORTED_WORKFLOW_EDGE_CONDITIONS = [
	"always",
	"on_success",
	"on_failure",
	"on_approval",
] as const;

export const SUPPORTED_WORKTREE_STRATEGIES = ["shared", "ephemeral"] as const;

export const SUPPORTED_WORKFLOW_TEMPLATES = [
	"trigger.manual",
	"task.agent",
	"gate.approval",
	"check.shell",
	"artifact.capture",
	"terminal.complete",
] as const;

export const SUPPORTED_TEMPLATE_BY_NODE_KIND = {
	trigger: "trigger.manual",
	task: "task.agent",
	gate: "gate.approval",
	check: "check.shell",
	artifact: "artifact.capture",
	terminal: "terminal.complete",
} as const;
