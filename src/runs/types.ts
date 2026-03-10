export interface RunLaunchRequest {
	configRoot: string;
	workflowId: string;
	repoBindings: Record<string, string>;
}

export interface RunLaunchWorkflowSnapshot {
	workflowId: string;
	name: string;
	summary?: string;
	contentHash: string;
	filePath: string;
}

export type ResolvedRunRepositoryBinding =
	| {
			repoId: string;
			label: string;
			required: true;
			status: "resolved";
			resolvedPath: string;
	  }
	| {
			repoId: string;
			label: string;
			required: false;
			status: "resolved";
			resolvedPath: string;
	  }
	| {
			repoId: string;
			label: string;
			required: false;
			status: "unbound_optional";
			resolvedPath: null;
	  };

export interface ResolvedRunLaunchRequest {
	configRoot: string;
	workflow: RunLaunchWorkflowSnapshot;
	repoBindings: ResolvedRunRepositoryBinding[];
}
