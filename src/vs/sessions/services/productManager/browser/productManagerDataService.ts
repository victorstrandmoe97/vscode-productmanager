/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { Position } from '../../../../editor/common/core/position.js';
import { SymbolKind } from '../../../../editor/common/languages.js';
import { OutlineModel } from '../../../../editor/contrib/documentSymbols/browser/outlineModel.js';
import { getHoversPromise } from '../../../../editor/contrib/hover/browser/getHover.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { localize } from '../../../../nls.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ChatMessageRole, getTextResponseFromStream, ILanguageModelsService } from '../../../../workbench/contrib/chat/common/languageModels.js';
import {
	IProductManagerArtifactsState,
	IProductManagerDataService,
	IProductManagerFeatureModel,
	IProductManagerJiraModel,
	IProductManagerLaneModel,
	IProductManagerMarketModel,
	IProductManagerOverviewModel,
	IUserStory,
	PRODUCT_MANAGER_ESTIMATOR_URL_SETTING,
	PRODUCT_MANAGER_REPO_ID_SETTING,
	PRODUCT_MANAGER_REPO_URL_SETTING,
	PRODUCT_MANAGER_REPOS_PATH_SETTING,
	ProductManagerLaneId,
} from '../common/productManager.js';

const defaultOverview: IProductManagerOverviewModel = {
	title: localize('productOverviewTitle', "Product Overview"),
	summary: localize('productOverviewSummary', "Product Mode turns the repository into a product map so owners can explore the system in terms of features, architecture lanes, and delivery risk."),
	highlights: [
		localize('productHighlightArchitecture', "Architecture lanes follow the estimator taxonomy and stay stable across restarts."),
		localize('productHighlightConvergence', "Features, Jira issues, and market context will all converge into one PM-first workspace."),
		localize('productHighlightCopilot', "Copilot stays available, but the shell now opens with product-language framing by default."),
	],
};

const defaultArchitecture: readonly IProductManagerLaneModel[] = [
	{ id: 'shared', title: localize('sharedLane', "Shared"), summary: localize('sharedLaneSummary', "Cross-cutting utilities, reusable libraries, and common contracts."), coverageLabel: localize('pendingGeneratedCoverage', "Pending Generated Coverage") },
	{ id: 'application', title: localize('applicationLane', "Application"), summary: localize('applicationLaneSummary', "Workflow orchestration, use-case coordination, and product logic."), coverageLabel: localize('pendingGeneratedCoverage', "Pending Generated Coverage") },
	{ id: 'presentation', title: localize('presentationLane', "Presentation"), summary: localize('presentationLaneSummary', "User-facing views, interaction flows, and visible experiences."), coverageLabel: localize('pendingGeneratedCoverage', "Pending Generated Coverage") },
	{ id: 'entrypoint', title: localize('entrypointLane', "Entrypoint"), summary: localize('entrypointLaneSummary', "Bootstrapping, initialization, and product entry surfaces."), coverageLabel: localize('pendingGeneratedCoverage', "Pending Generated Coverage") },
	{ id: 'ops', title: localize('opsLane', "Ops"), summary: localize('opsLaneSummary', "Operational tooling, release plumbing, and maintenance workflows."), coverageLabel: localize('pendingGeneratedCoverage', "Pending Generated Coverage") },
	{ id: 'data', title: localize('dataLane', "Data"), summary: localize('dataLaneSummary', "Persistence, transport layers, and stateful integration seams."), coverageLabel: localize('pendingGeneratedCoverage', "Pending Generated Coverage") },
	{ id: 'domain', title: localize('domainLane', "Domain"), summary: localize('domainLaneSummary', "Core business rules, decision logic, and product semantics."), coverageLabel: localize('pendingGeneratedCoverage', "Pending Generated Coverage") },
];

const defaultFeatures: readonly IProductManagerFeatureModel[] = [];

const defaultJira: IProductManagerJiraModel = {
	summary: localize('jiraSummary', "Jira is not connected yet. Once connected, Product Mode will import issues, run the local complexity estimator, and render PM-readable summaries."),
	callToAction: localize('jiraCallToAction', "Connect Jira to start importing backlog context."),
	checklist: [
		localize('jiraChecklistImport', "Import issues from CSV or API."),
		localize('jiraChecklistEstimator', "Attach estimator output per issue."),
		localize('jiraChecklistPrompts', "Open product-thread prompts directly from issue rows."),
	],
};

const defaultMarket: IProductManagerMarketModel = {
	summary: localize('marketSummary', "Market blurbs are stubbed for phase 1. This area is reserved for competitor signals, category movement, and project-adjacent headlines."),
	topics: [
		localize('marketTopicCompetitors', "Competitor Product Changes"),
		localize('marketTopicCategory', "Category-Wide News"),
		localize('marketTopicAdjacent', "Adjacent Workflow Tooling"),
	],
};

/** Symbol kinds worth querying hover for (functions, methods, classes, interfaces). */
const HOVER_SYMBOL_KINDS = new Set([
	SymbolKind.Function,
	SymbolKind.Method,
	SymbolKind.Class,
	SymbolKind.Interface,
	SymbolKind.Constructor,
]);

const SYMBOL_KIND_NAMES: Record<number, string> = {
	[SymbolKind.File]: 'File',
	[SymbolKind.Module]: 'Module',
	[SymbolKind.Namespace]: 'Namespace',
	[SymbolKind.Package]: 'Package',
	[SymbolKind.Class]: 'Class',
	[SymbolKind.Method]: 'Method',
	[SymbolKind.Property]: 'Property',
	[SymbolKind.Field]: 'Field',
	[SymbolKind.Constructor]: 'Constructor',
	[SymbolKind.Enum]: 'Enum',
	[SymbolKind.Interface]: 'Interface',
	[SymbolKind.Function]: 'Function',
	[SymbolKind.Variable]: 'Variable',
	[SymbolKind.Constant]: 'Constant',
	[SymbolKind.String]: 'String',
	[SymbolKind.Number]: 'Number',
	[SymbolKind.Boolean]: 'Boolean',
	[SymbolKind.Array]: 'Array',
	[SymbolKind.Object]: 'Object',
	[SymbolKind.Key]: 'Key',
	[SymbolKind.Null]: 'Null',
	[SymbolKind.EnumMember]: 'EnumMember',
	[SymbolKind.Struct]: 'Struct',
	[SymbolKind.Event]: 'Event',
	[SymbolKind.Operator]: 'Operator',
	[SymbolKind.TypeParameter]: 'TypeParameter',
};

const MAX_HOVER_SYMBOLS_PER_FILE = 12;

interface RawFeature {
	title: string;
	summary: string;
	lanes: string[];
}

interface EnrichedSymbol {
	name: string;
	kind: string;
	hoverText: string;
}

export class ProductManagerDataService extends Disposable implements IProductManagerDataService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private artifactsState: IProductManagerArtifactsState = {
		status: 'notGenerated',
		message: localize('productArtifactsNoRepoId', "Connect a GitHub repository to load the architecture map."),
	};
	private overview = defaultOverview;
	private architecture = defaultArchitecture;
	private features: readonly IProductManagerFeatureModel[] = defaultFeatures;
	private jira = defaultJira;
	private market = defaultMarket;

	/** In-memory GitHub credentials for the current session — used by recookAndRefresh. */
	private _githubToken: string | undefined;
	private _githubUsername: string | undefined;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
		@ITextModelService private readonly textModelService: ITextModelService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
	) {
		super();

		// Auto-load from API on startup if a repo is already configured.
		const repoId = this.configurationService.getValue<string>(PRODUCT_MANAGER_REPO_ID_SETTING) || '';
		if (repoId) {
			void this.fetchArchitectureFromApi();
		}
	}

	getArtifactsState(): IProductManagerArtifactsState {
		return this.artifactsState;
	}

	getOverview(): IProductManagerOverviewModel {
		return this.overview;
	}

	getArchitecture(): readonly IProductManagerLaneModel[] {
		return this.architecture;
	}

	getFeatures(): readonly IProductManagerFeatureModel[] {
		return this.features;
	}

	getJira(): IProductManagerJiraModel {
		return this.jira;
	}

	getMarket(): IProductManagerMarketModel {
		return this.market;
	}

	async connectRepository(repoUrl: string, githubToken?: string, githubUsername?: string): Promise<void> {
		const baseUrl = (this.configurationService.getValue<string>(PRODUCT_MANAGER_ESTIMATOR_URL_SETTING) || 'http://localhost:8000').replace(/\/$/, '');

		const urlMatch = repoUrl.replace(/\.git$/, '').match(/github\.com[/:](.+)/i);
		const name = urlMatch ? urlMatch[1] : repoUrl;

		if (githubToken) {
			this._githubToken = githubToken;
			this._githubUsername = githubUsername || 'git';
		}

		this.logService.info('[ProductManagerDataService] connectRepository: url=%s pat_provided=%s username=%s', repoUrl, !!githubToken, this._githubUsername);

		this.artifactsState = {
			status: 'loading',
			message: localize('connectingRepo', "Connecting repository {0}…", name),
		};
		this._onDidChange.fire();

		let repoId: string;
		try {
			const createResp = await fetch(`${baseUrl}/api/repos`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ github_url: repoUrl, name, default_branch: 'main' }),
			});
			if (!createResp.ok) {
				throw new Error(`HTTP ${createResp.status}: ${createResp.statusText}`);
			}
			const created = await createResp.json() as { id: string };
			repoId = created.id;
			this.logService.info('[ProductManagerDataService] connectRepository: registered repo_id=%s', repoId);
		} catch (error) {
			this.logService.error('[ProductManagerDataService] connectRepository: POST /api/repos failed:', error);
			this.artifactsState = {
				status: 'error',
				message: localize('connectRepoFailed', "Failed to connect repository: {0}", String(error)),
			};
			this._onDidChange.fire();
			return;
		}

		await this.configurationService.updateValue(PRODUCT_MANAGER_REPO_ID_SETTING, repoId, ConfigurationTarget.USER);
		await this.configurationService.updateValue(PRODUCT_MANAGER_REPO_URL_SETTING, repoUrl, ConfigurationTarget.USER);
		this.logService.info('[ProductManagerDataService] connectRepository: saved repo_id and repo_url to user settings');

		this.artifactsState = {
			status: 'loading',
			message: localize('ingestingRepo', "Indexing repository {0} — this may take a minute…", name),
		};
		this._onDidChange.fire();

		try {
			const ingestBody: Record<string, string> = {};
			if (githubToken) {
				ingestBody['github_username'] = githubUsername || 'git';
				ingestBody['github_token'] = githubToken;
			}
			const ingestResp = await fetch(`${baseUrl}/api/repos/${encodeURIComponent(repoId)}/ingest`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(Object.keys(ingestBody).length ? ingestBody : null),
			});
			if (!ingestResp.ok) {
				throw new Error(`HTTP ${ingestResp.status}: ${ingestResp.statusText}`);
			}
			this.logService.info('[ProductManagerDataService] connectRepository: ingestion started for repo_id=%s', repoId);
		} catch (error) {
			this.logService.error('[ProductManagerDataService] connectRepository: POST /api/repos/ingest failed:', error);
			this.artifactsState = {
				status: 'error',
				message: localize('ingestFailed', "Ingestion failed: {0}", String(error)),
			};
			this._onDidChange.fire();
			return;
		}

		const maxPolls = 75;
		for (let i = 0; i < maxPolls; i++) {
			await new Promise<void>(resolve => setTimeout(resolve, 4000));
			try {
				const statusResp = await fetch(`${baseUrl}/api/repos/${encodeURIComponent(repoId)}/ingest-status`);
				if (!statusResp.ok) { continue; }
				const status = await statusResp.json() as { phase?: string; error?: string };
				this.logService.info('[ProductManagerDataService] connectRepository: ingest phase=%s (poll %d)', status.phase, i + 1);

				if (status.phase === 'error') {
					this.artifactsState = {
						status: 'error',
						message: localize('ingestErrorPhase', "Indexing failed: {0}", status.error ?? 'unknown error'),
					};
					this._onDidChange.fire();
					return;
				}

				if (status.phase === 'done') {
					this.logService.info('[ProductManagerDataService] connectRepository: indexing complete, fetching architecture');
					break;
				}

				this.artifactsState = {
					status: 'loading',
					message: localize('ingestProgress', "Indexing {0} — phase: {1}…", name, status.phase ?? 'running'),
				};
				this._onDidChange.fire();
			} catch {
				// transient network error during poll, continue
			}
		}

		await this.fetchArchitectureFromApi();
	}

	async disconnectRepository(): Promise<void> {
		this.logService.info('[ProductManagerDataService] disconnectRepository: clearing repo_id, repo_url, and in-memory credentials');
		this._githubToken = undefined;
		this._githubUsername = undefined;
		await this.configurationService.updateValue(PRODUCT_MANAGER_REPO_ID_SETTING, undefined, ConfigurationTarget.USER);
		await this.configurationService.updateValue(PRODUCT_MANAGER_REPO_URL_SETTING, undefined, ConfigurationTarget.USER);
		this.overview = defaultOverview;
		this.architecture = defaultArchitecture;
		this.features = defaultFeatures;
		this.artifactsState = {
			status: 'notGenerated',
			message: localize('repositoryDisconnected', "Repository disconnected. Connect a GitHub repository to load the architecture map."),
		};
		this._onDidChange.fire();
	}

	async recookAndRefresh(): Promise<void> {
		const baseUrl = (this.configurationService.getValue<string>(PRODUCT_MANAGER_ESTIMATOR_URL_SETTING) || 'http://localhost:8000').replace(/\/$/, '');
		const repoId = this.configurationService.getValue<string>(PRODUCT_MANAGER_REPO_ID_SETTING) || '';

		if (!repoId) {
			this.logService.warn('[ProductManagerDataService] recookAndRefresh: no repoId set — use "Connect Repository" first');
			this.artifactsState = {
				status: 'notGenerated',
				message: localize('recookNoRepoId', "Connect a GitHub repository before refreshing."),
			};
			this._onDidChange.fire();
			return;
		}

		if (!this._githubToken) {
			this.logService.warn('[ProductManagerDataService] recookAndRefresh: no in-memory token — re-clone may fail for private repos. Use "Change Repository" to reconnect with credentials.');
		}

		this.logService.info('[ProductManagerDataService] recookAndRefresh: starting recook for repoId=%s', repoId);
		this.artifactsState = {
			status: 'loading',
			message: localize('recookIndexing', "Re-indexing repository — this may take a minute…"),
		};
		this._onDidChange.fire();

		try {
			const recookBody: Record<string, string> = {};
			if (this._githubToken) {
				recookBody['github_username'] = this._githubUsername || 'git';
				recookBody['github_token'] = this._githubToken;
			}
			const recookResp = await fetch(`${baseUrl}/api/repos/${encodeURIComponent(repoId)}/recook`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(Object.keys(recookBody).length ? recookBody : null),
			});
			if (!recookResp.ok) {
				const body = await recookResp.text().catch(() => recookResp.statusText);
				throw new Error(`HTTP ${recookResp.status}: ${body}`);
			}
			const result = await recookResp.json() as { status: string; cook_status?: string; symbols?: number };
			this.logService.info('[ProductManagerDataService] recookAndRefresh: recook complete — cook_status=%s symbols=%d',
				result.cook_status, result.symbols ?? 0);
		} catch (error) {
			this.logService.error('[ProductManagerDataService] recookAndRefresh failed:', error);
			this.artifactsState = {
				status: 'error',
				message: localize('recookFailed', "Re-indexing failed: {0}", String(error)),
			};
			this._onDidChange.fire();
			return;
		}

		await this.fetchArchitectureFromApi();
	}

	async fetchArchitectureFromApi(): Promise<void> {
		const baseUrl = (this.configurationService.getValue<string>(PRODUCT_MANAGER_ESTIMATOR_URL_SETTING) || 'http://localhost:8000').replace(/\/$/, '');
		const repoId = this.configurationService.getValue<string>(PRODUCT_MANAGER_REPO_ID_SETTING) || '';

		if (!repoId) {
			this.logService.warn('[ProductManagerDataService] fetchArchitectureFromApi: no repoId set — use "Connect Repository" first');
			this.artifactsState = {
				status: 'notGenerated',
				message: localize('productArtifactsNoRepoId', "Connect a GitHub repository to load the architecture map."),
			};
			this._onDidChange.fire();
			return;
		}

		this.logService.info('[ProductManagerDataService] fetchArchitectureFromApi: baseUrl=%s repoId=%s', baseUrl, repoId);
		this.artifactsState = {
			status: 'loading',
			message: localize('architectureLoading', "Loading architecture map…"),
		};
		this._onDidChange.fire();

		try {
			const response = await fetch(`${baseUrl}/api/repos/${encodeURIComponent(repoId)}/architecture`);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}
			const data = await response.json() as {
				generated_at: string;
				file_count: number;
				lanes: Array<{
					id: string;
					label: string;
					summary: string;
					file_count: number;
					weight: number;
					files: string[];
				}>;
			};

			// Strip the Docker-internal prefix "repos/{uuid}/" from every path.
			const repoPathPrefix = new RegExp(`^/?repos/${repoId}/`);
			const stripPrefix = (p: string) => p.replace(repoPathPrefix, '');

			const knownLaneIds = new Set<string>(['shared', 'application', 'presentation', 'entrypoint', 'ops', 'data', 'domain']);
			this.architecture = data.lanes.map(lane => {
				const laneId = knownLaneIds.has(lane.id) ? (lane.id as ProductManagerLaneId) : 'shared' as ProductManagerLaneId;
				const pct = Math.round(lane.weight * 100);
				return {
					id: laneId,
					title: lane.label,
					summary: lane.summary,
					coverageLabel: localize('coverageFromApi', "{0} files · {1}%", lane.file_count, pct),
					files: lane.files.map(stripPrefix),
					fileCount: lane.file_count,
					weight: lane.weight,
				} satisfies IProductManagerLaneModel;
			});

			this.artifactsState = {
				status: 'ready',
				message: localize('productArtifactsApiReady', "Architecture map loaded from complexity-estimator ({0} files).", data.file_count),
				generatedAt: data.generated_at,
			};
			this.logService.info('[ProductManagerDataService] fetchArchitectureFromApi: loaded %d lanes, %d total files', data.lanes.length, data.file_count);
		} catch (error) {
			this.logService.error('[ProductManagerDataService] fetchArchitectureFromApi failed:', error);
			this.artifactsState = {
				status: 'error',
				message: localize('productArtifactsApiFailed', "Failed to load architecture from the complexity-estimator: {0}", String(error)),
			};
		}

		this._onDidChange.fire();
	}

	// ---------------------------------------------------------------------------
	// Feature discovery
	// ---------------------------------------------------------------------------

	async discoverFeatures(): Promise<void> {
		const repoId = this.configurationService.getValue<string>(PRODUCT_MANAGER_REPO_ID_SETTING) || '';
		if (!repoId) {
			this.logService.warn('[ProductManagerDataService] discoverFeatures: no repoId — connect a repository first');
			return;
		}

		if (this.architecture.length === 0 || this.artifactsState.status !== 'ready') {
			this.logService.warn('[ProductManagerDataService] discoverFeatures: architecture not loaded yet');
			return;
		}

		this.logService.info('[ProductManagerDataService] discoverFeatures: starting feature discovery for repoId=%s', repoId);

		// ------------------------------------------------------------------
		// Phase 1: Discover features from file paths
		// ------------------------------------------------------------------
		this._onDidChange.fire();

		const laneContext = this.architecture
			.filter(lane => lane.files && lane.files.length > 0)
			.map(lane => {
				const fileList = (lane.files ?? []).slice(0, 60).join('\n  - ');
				return `${lane.id.toUpperCase()} (${lane.files?.length ?? 0} files):\n  - ${fileList}`;
			})
			.join('\n\n');

		const phase1SystemPrompt = `You are a senior product engineer analyzing a software repository.
Your task: identify ONLY distinct user-facing product features — not architectural layers, not internal utilities, not infrastructure.
A feature is something a real user or business stakeholder would recognise and care about.
Base your analysis strictly on the file paths provided.
Reply ONLY with a valid JSON array, no prose, no markdown fences.
Each element: {"title": "short feature name", "summary": "one sentence product description", "lanes": ["lane_id", ...]}`;

		const phase1UserPrompt = `Here are the repository files grouped by architectural lane:\n\n${laneContext}\n\nIdentify 4-10 distinct product features this codebase implements.`;

		this.logService.info('[ProductManagerDataService] discoverFeatures: phase 1 — calling LLM for feature clustering');
		let rawFeatures: RawFeature[];
		try {
			rawFeatures = await this._callLLM(phase1SystemPrompt, phase1UserPrompt);
			this.logService.info('[ProductManagerDataService] discoverFeatures: phase 1 complete — %d features discovered', rawFeatures.length);
		} catch (error) {
			this.logService.error('[ProductManagerDataService] discoverFeatures: phase 1 LLM call failed:', error);
			return;
		}

		// ------------------------------------------------------------------
		// Phase 2: LSP enrichment — symbols + hover per feature
		// ------------------------------------------------------------------
		this.logService.info('[ProductManagerDataService] discoverFeatures: phase 2 — LSP symbol enrichment');
		const featureSymbols = await this._enrichFeaturesWithLSP(rawFeatures, repoId);

		// ------------------------------------------------------------------
		// Phase 3: Generate user stories from enriched symbols
		// ------------------------------------------------------------------
		this.logService.info('[ProductManagerDataService] discoverFeatures: phase 3 — calling LLM for user stories');

		const featuresContext = rawFeatures.map((f, i) => {
			const symbols = featureSymbols[i] ?? [];
			const symbolList = symbols.length > 0
				? symbols.map(s => `    - ${s.name} (${s.kind})${s.hoverText ? ': ' + s.hoverText.split('\n')[0] : ''}`).join('\n')
				: '    (no symbols resolved)';
			return `Feature: ${f.title}\nSummary: ${f.summary}\nLanes: ${f.lanes.join(', ')}\nCode symbols:\n${symbolList}`;
		}).join('\n\n---\n\n');

		const phase3SystemPrompt = `You are a senior product engineer writing a product backlog.
For each feature, write 1-10 user stories based strictly on what the code symbols show the software actually does.
Use "As a [user], I want [action] so that [value]" format for each story.
Reply ONLY with a valid JSON array, no prose, no markdown fences.
Each element: {"featureTitle": "...", "stories": [{"title": "short name", "description": "As a..."}]}`;

		const phase3UserPrompt = `Here are the product features with their code symbols:\n\n${featuresContext}\n\nWrite user stories for each feature.`;

		let userStoriesResult: Array<{ featureTitle: string; stories: Array<{ title: string; description: string }> }>;
		try {
			userStoriesResult = await this._callLLM(phase3SystemPrompt, phase3UserPrompt);
			this.logService.info('[ProductManagerDataService] discoverFeatures: phase 3 complete — user stories generated');
		} catch (error) {
			this.logService.error('[ProductManagerDataService] discoverFeatures: phase 3 LLM call failed:', error);
			// Still surface features without user stories
			userStoriesResult = [];
		}

		// Build lookup for user stories by feature title
		const storiesByTitle = new Map<string, readonly IUserStory[]>();
		for (const entry of userStoriesResult) {
			if (entry.featureTitle && Array.isArray(entry.stories)) {
				storiesByTitle.set(entry.featureTitle, entry.stories.map(s => ({
					title: s.title ?? '',
					description: s.description ?? '',
				})));
			}
		}

		const knownLaneIds = new Set<string>(['shared', 'application', 'presentation', 'entrypoint', 'ops', 'data', 'domain']);

		this.features = rawFeatures.map(f => ({
			title: f.title,
			summary: f.summary,
			lanes: f.lanes.filter(l => knownLaneIds.has(l)) as ProductManagerLaneId[],
			userStories: storiesByTitle.get(f.title) ?? [],
		}));

		this.logService.info('[ProductManagerDataService] discoverFeatures: complete — %d features with user stories', this.features.length);
		this._onDidChange.fire();
	}

	// ---------------------------------------------------------------------------
	// LSP enrichment helpers
	// ---------------------------------------------------------------------------

	private async _enrichFeaturesWithLSP(features: RawFeature[], repoId: string): Promise<EnrichedSymbol[][]> {
		const reposPath = this._resolveReposPath();
		this.logService.info('[ProductManagerDataService] _enrichFeaturesWithLSP: reposPath=%s', reposPath);

		// Build a lane→files map for quick lookup
		const laneFilesMap = new Map<string, readonly string[]>();
		for (const lane of this.architecture) {
			laneFilesMap.set(lane.id, lane.files ?? []);
		}

		const result: EnrichedSymbol[][] = [];

		for (const feature of features) {
			// Collect all files belonging to this feature's lanes
			const featureFiles = new Set<string>();
			for (const laneId of feature.lanes) {
				for (const f of laneFilesMap.get(laneId) ?? []) {
					featureFiles.add(f);
				}
			}

			// Cap at 20 files per feature to avoid excessive LSP calls
			const filesToQuery = [...featureFiles].slice(0, 20);
			const enriched: EnrichedSymbol[] = [];

			for (const relativePath of filesToQuery) {
				try {
					const fileUri = URI.file(`${reposPath}/${repoId}/${relativePath}`);
					const symbols = await this._getSymbolsWithHover(fileUri);
					enriched.push(...symbols);
					this.logService.info('[ProductManagerDataService] _enrichFeaturesWithLSP: %s → %d symbols', relativePath, symbols.length);
				} catch (err) {
					this.logService.warn('[ProductManagerDataService] _enrichFeaturesWithLSP: skipping %s — %s', relativePath, err);
				}
			}

			const hoverCount = enriched.filter(s => s.hoverText).length;
			this.logService.info('[ProductManagerDataService] _enrichFeaturesWithLSP: feature "%s" — %d symbols, hover coverage %d%%',
				feature.title, enriched.length, enriched.length > 0 ? Math.round(hoverCount / enriched.length * 100) : 0);

			result.push(enriched);
		}

		return result;
	}

	private async _getSymbolsWithHover(uri: URI): Promise<EnrichedSymbol[]> {
		const cts = new CancellationTokenSource();
		const ref = await this.textModelService.createModelReference(uri);
		try {
			const model = ref.object.textEditorModel;
			const outlineModel = await OutlineModel.create(this.languageFeaturesService.documentSymbolProvider, model, cts.token);
			const docSymbols = outlineModel.asListOfDocumentSymbols();

			const enriched: EnrichedSymbol[] = [];
			const candidates = docSymbols.filter(s => HOVER_SYMBOL_KINDS.has(s.kind)).slice(0, MAX_HOVER_SYMBOLS_PER_FILE);

			for (const sym of candidates) {
				const position = new Position(sym.range.startLineNumber, sym.range.startColumn);
				let hoverText = '';
				try {
					const hovers = await getHoversPromise(this.languageFeaturesService.hoverProvider, model, position, cts.token);
					hoverText = hovers
						.flatMap(h => Array.isArray(h.contents) ? h.contents : [h.contents])
						.map(c => (typeof c === 'string' ? c : c.value))
						.join(' ')
						.replace(/\s+/g, ' ')
						.trim()
						.slice(0, 200);
				} catch {
					// hover failed — proceed with name+kind only
				}
				enriched.push({ name: sym.name, kind: SYMBOL_KIND_NAMES[sym.kind] ?? String(sym.kind), hoverText });
			}

			return enriched;
		} finally {
			ref.dispose();
			cts.dispose();
		}
	}

	/** Resolve the local host path to the bind-mounted repos directory. */
	private _resolveReposPath(): string {
		const configured = (this.configurationService.getValue<string>(PRODUCT_MANAGER_REPOS_PATH_SETTING) || '').trim();
		if (configured) {
			return configured.replace(/\/$/, '');
		}

		// Auto-detect: the extension lives at …/vscode-productmanager/out/vs/…
		// The bind mount is at …/vscode-productmanager/complexity-estimator/repos
		// Walk up from the workspace folders as a reasonable fallback.
		const folders = this.workspaceContextService.getWorkspace().folders;
		if (folders.length > 0) {
			const wsRoot = folders[0].uri.fsPath.replace(/\/$/, '');
			return `${wsRoot}/complexity-estimator/repos`;
		}

		// Last resort: relative to cwd
		return './complexity-estimator/repos';
	}

	// ---------------------------------------------------------------------------
	// LLM helper
	// ---------------------------------------------------------------------------

	private async _callLLM<T = unknown>(systemPrompt: string, userPrompt: string): Promise<T> {
		const models = await this.languageModelsService.selectLanguageModels({ vendor: 'copilot', id: 'copilot-fast' });
		if (!models.length) {
			throw new Error('No copilot-fast model available');
		}

		this.logService.info('[ProductManagerDataService] _callLLM: using model=%s', models[0]);

		const cts = new CancellationTokenSource();
		const response = await this.languageModelsService.sendChatRequest(
			models[0],
			undefined,
			[
				{ role: ChatMessageRole.System, content: [{ type: 'text', value: systemPrompt }] },
				{ role: ChatMessageRole.User, content: [{ type: 'text', value: userPrompt }] },
			],
			{ modelOptions: { temperature: 0 } },
			cts.token,
		);

		const text = await getTextResponseFromStream(response);
		cts.dispose();

		// Strip markdown fences if the model wrapped the JSON
		const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
		this.logService.info('[ProductManagerDataService] _callLLM: response length=%d chars', cleaned.length);

		try {
			return JSON.parse(cleaned) as T;
		} catch (err) {
			throw new Error(`LLM returned invalid JSON: ${err}\n---\n${cleaned.slice(0, 300)}`);
		}
	}
}
