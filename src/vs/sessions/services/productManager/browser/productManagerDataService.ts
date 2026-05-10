/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IJiraAuthService, IJiraMappingService, IJiraSyncService } from '../common/jira.js';
import {
	IJiraConnectOptions,
	IJiraConnectionState,
	IJiraIssue,
	IJiraMappingCandidate,
	IJiraSyncState,
	IProductManagerArtifactsState,
	IProductManagerDataService,
	IProductManagerFeatureModel,
	IProductManagerFeaturesMetadata,
	IProductManagerJiraModel,
	IProductManagerLaneModel,
	IProductManagerMarketModel,
	IProductManagerOverviewModel,
	OPEN_DISCOVER_CHAT_COMMAND_ID,
	PRODUCT_MANAGER_ESTIMATOR_URL_SETTING,
	ProductManagerLaneId,
	PRODUCT_MANAGER_REPO_ID_SETTING,
	PRODUCT_MANAGER_REPO_URL_SETTING,
} from '../common/productManager.js';
import { IRepoManifestService, IProductManagerRepoManifest } from '../common/repoManifest.js';
import { IContextResolverService, IResolvedProductManagerContext } from '../common/toolBindings.js';
import { IFeaturesIntegrationService, IProductManagerActivationResult, IProductManagerActivationService } from '../common/toolIntegration.js';

const defaultOverview: IProductManagerOverviewModel = {
	title: localize('productOverviewTitle', "Product Overview"),
	summary: localize('productOverviewSummary', "Product Mode maps a live repository into architecture lanes, product features, and user stories — all queryable through Copilot."),
	highlights: [
		localize('productHighlightArchitecture', "Architecture Lanes — the complexity-estimator classifies every file into 7 structural layers so you can reason about the codebase as a product."),
		localize('productHighlightFeatures', "Feature Discovery — Copilot analyses code symbols and call graphs to surface product features with user stories derived from real code signals."),
		localize('productHighlightCopilot', "Copilot Agent — every architecture lane and discovered feature is available as chat context, so you can ask product questions grounded in code."),
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
	connection: { status: 'disconnected' },
	sync: { status: 'idle' },
	selectedProjects: [],
	issueCount: 0,
	issues: [],
	unmappedIssueCount: 0,
};

const defaultMarket: IProductManagerMarketModel = {
	summary: localize('marketSummary', "Market blurbs are stubbed for phase 1. This area is reserved for competitor signals, category movement, and project-adjacent headlines."),
	topics: [
		localize('marketTopicCompetitors', "Competitor Product Changes"),
		localize('marketTopicCategory', "Category-Wide News"),
		localize('marketTopicAdjacent', "Adjacent Workflow Tooling"),
	],
};

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
	private _featuresMetadata: IProductManagerFeaturesMetadata | undefined;
	private jira = defaultJira;
	private jiraIssues: readonly IJiraIssue[] = [];
	private jiraMappings: readonly IJiraMappingCandidate[] = [];
	private jiraConnection: IJiraConnectionState = defaultJira.connection;
	private jiraSync: IJiraSyncState = defaultJira.sync;
	private market = defaultMarket;
	private currentContext: IResolvedProductManagerContext | undefined;

	/** In-memory GitHub credentials for the current session — used by recookAndRefresh. */
	private _githubToken: string | undefined;
	private _githubUsername: string | undefined;

	constructor(
		@IJiraAuthService private readonly jiraAuthService: IJiraAuthService,
		@IJiraSyncService private readonly jiraSyncService: IJiraSyncService,
		@IJiraMappingService private readonly jiraMappingService: IJiraMappingService,
		@IFeaturesIntegrationService private readonly featuresIntegrationService: IFeaturesIntegrationService,
		@IProductManagerActivationService private readonly productManagerActivationService: IProductManagerActivationService,
		@IRepoManifestService private readonly repoManifestService: IRepoManifestService,
		@IContextResolverService private readonly contextResolverService: IContextResolverService,
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ICommandService private readonly commandService: ICommandService,
		@IOpenerService private readonly openerService: IOpenerService,
	) {
		super();

		void this.restoreContextState();

		// Auto-load architecture from API on startup if a repo is already configured.
		const repoId = this.configurationService.getValue<string>(PRODUCT_MANAGER_REPO_ID_SETTING) || '';
		if (repoId) {
			void this.fetchArchitectureFromApi();
		}
	}

	private async restoreContextState(): Promise<void> {
		const restored = await this.productManagerActivationService.restore(this.architecture, this.features).catch(error => {
			this.logService.error('[ProductManagerDataService] restoreContextState: activation restore failed', error);
			return undefined;
		});
		this.applyActivationResult(restored);
		this.updateJiraModel();
		this._onDidChange.fire();
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

	getFeaturesMetadata(): IProductManagerFeaturesMetadata | undefined {
		return this._featuresMetadata;
	}

	getJira(): IProductManagerJiraModel {
		return this.jira;
	}

	getMarket(): IProductManagerMarketModel {
		return this.market;
	}

	async connectJira(options: IJiraConnectOptions): Promise<void> {
		this.logService.info('[ProductManagerDataService] connectJira: site=%s projects=%d', options.siteUrl, options.projectKeys.length);
		this.jiraConnection = {
			status: 'connecting',
			siteUrl: options.siteUrl,
			accountEmail: options.email,
		};
		this.jiraSync = {
			status: 'idle',
			message: localize('jiraConnectStarting', "Connecting Jira…"),
		};
		this.updateJiraModel();
		this._onDidChange.fire();

		try {
			const session = await this.jiraAuthService.connect(options);
			await this.persistJiraBinding({
				profileId: session.profileId,
				projectKeys: options.projectKeys,
				filterId: options.filterId,
				jql: options.jql,
			});
			await this.refreshContext();
			this.jiraConnection = await this.jiraAuthService.validateSession(session.profileId);
			await this.refreshJira({ full: true });
		} catch (error) {
			this.logService.error('[ProductManagerDataService] connectJira failed:', error);
			this.jiraConnection = {
				status: 'error',
				siteUrl: options.siteUrl,
				accountEmail: options.email,
				lastError: error instanceof Error ? error.message : String(error),
			};
			this.jiraSync = {
				status: 'error',
				lastError: error instanceof Error ? error.message : String(error),
				message: localize('jiraConnectFailed', "Jira connection failed."),
			};
			this.updateJiraModel();
			this._onDidChange.fire();
		}
	}

	async disconnectJira(): Promise<void> {
		this.logService.info('[ProductManagerDataService] disconnectJira');
		await this.refreshContext();
		const jiraBinding = this.currentContext?.bindings.jira;
		if (jiraBinding) {
			await this.jiraAuthService.disconnect(jiraBinding.profile?.id ?? jiraBinding.binding?.profileId);
			await this.jiraSyncService.clear(jiraBinding);
		}
		await this.persistJiraBinding(undefined);
		await this.refreshContext();
		this.jiraConnection = { status: 'disconnected' };
		this.jiraSync = { status: 'idle' };
		this.jiraIssues = [];
		this.jiraMappings = [];
		this.updateJiraModel();
		this._onDidChange.fire();
	}

	async refreshJira(options?: { full?: boolean }): Promise<void> {
		this.logService.info('[ProductManagerDataService] refreshJira: full=%s', options?.full === true);
		await this.refreshContext();
		const jiraBinding = this.currentContext?.bindings.jira;
		if (!jiraBinding) {
			this.jiraConnection = { status: 'disconnected' };
			this.jiraSync = {
				status: 'error',
				message: localize('jiraRefreshNoConnection', "Connect Jira before refreshing."),
			};
			this.updateJiraModel();
			this._onDidChange.fire();
			return;
		}

		this.jiraConnection = await this.jiraAuthService.validateSession(jiraBinding.profile?.id ?? jiraBinding.binding?.profileId);
		if (this.jiraConnection.status !== 'connected') {
			this.jiraSync = {
				status: 'error',
				lastError: this.jiraConnection.lastError,
				message: this.jiraConnection.lastError ?? localize('jiraRefreshNoConnection', "Connect Jira before refreshing."),
			};
			this.updateJiraModel();
			this._onDidChange.fire();
			return;
		}

		this.jiraSync = {
			status: 'syncing',
			lastSyncStartedAt: new Date().toISOString(),
			message: localize('jiraRefreshing', "Refreshing Jira issues…"),
		};
		this.updateJiraModel();
		this._onDidChange.fire();

		try {
			const syncResult = await this.jiraSyncService.refresh(jiraBinding, options);
			this.jiraIssues = syncResult.issues;
			this.jiraMappings = await this.jiraMappingService.mapIssuesToProductContext(this.jiraIssues, this.features, this.architecture);
			this.jiraSync = syncResult.sync;
			this.jiraConnection = await this.jiraAuthService.validateSession(jiraBinding.profile?.id ?? jiraBinding.binding?.profileId);
			this.updateJiraModel();
			this._onDidChange.fire();
		} catch (error) {
			this.logService.error('[ProductManagerDataService] refreshJira failed:', error);
			this.jiraSync = {
				status: 'error',
				lastSyncStartedAt: this.jiraSync.lastSyncStartedAt,
				lastError: error instanceof Error ? error.message : String(error),
				message: localize('jiraRefreshFailed', "Failed to refresh Jira issues."),
			};
			this.updateJiraModel();
			this._onDidChange.fire();
		}
	}

	async openJiraIssue(issueKey: string): Promise<void> {
		const issue = this.getIssueByKey(issueKey);
		if (!issue) {
			this.logService.warn('[ProductManagerDataService] openJiraIssue: missing issue=%s', issueKey);
			return;
		}

		await this.openerService.open(URI.parse(issue.url), { openExternal: true });
	}

	async askCopilotAboutJiraIssue(issueKey: string): Promise<void> {
		const issue = this.getIssueByKey(issueKey);
		if (!issue) {
			this.logService.warn('[ProductManagerDataService] askCopilotAboutJiraIssue: missing issue=%s', issueKey);
			return;
		}

		const mapping = this.jiraMappings.find(candidate => candidate.issueKey === issue.key);
		await this.commandService.executeCommand(OPEN_DISCOVER_CHAT_COMMAND_ID, {
			query: this.buildJiraIssueChatPrompt(issue, mapping),
		});
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

		await this.refreshContext();
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
		this._featuresMetadata = undefined;
		this.jiraMappings = [];
		this.currentContext = undefined;
		this.updateJiraModel();
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
			this.logService.info('[ProductManagerDataService] recookAndRefresh: no in-memory token — public repos do not require credentials; for private repos use "Change Repository" to reconnect.');
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
				fileCount: data.file_count,
			};
			const activation = await this.productManagerActivationService.activate(this.architecture, this.artifactsState);
			this.applyActivationResult(activation);
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
		await this.refreshContext();
		if (!this.currentContext) {
			this.logService.warn('[ProductManagerDataService] discoverFeatures: no repoId — connect a repository first');
			return;
		}

		if (this.architecture.length === 0 || this.artifactsState.status !== 'ready') {
			this.logService.warn('[ProductManagerDataService] discoverFeatures: architecture not loaded yet');
			return;
		}

		const featureBinding = this.currentContext.bindings.features;
		if (!featureBinding?.enabled) {
			this.logService.warn('[ProductManagerDataService] discoverFeatures: features binding is disabled');
			return;
		}

		this.logService.info('[ProductManagerDataService] discoverFeatures: starting feature discovery for repoId=%s', this.currentContext.repoId);
		const result = await this.featuresIntegrationService.refresh(this.currentContext, featureBinding, this.architecture, this.artifactsState);
		this.features = result.features;
		this._featuresMetadata = result.metadata;

		if (this.jiraIssues.length > 0) {
			this.jiraMappings = await this.jiraMappingService.mapIssuesToProductContext(this.jiraIssues, this.features, this.architecture);
			this.updateJiraModel();
		}
		this._onDidChange.fire();
	}

	private async refreshContext(): Promise<void> {
		this.currentContext = await this.contextResolverService.resolveContext();
	}

	private applyActivationResult(result: IProductManagerActivationResult | undefined): void {
		if (!result) {
			return;
		}

		this.currentContext = result.context ?? this.currentContext;
		if (result.features) {
			this.features = result.features.features;
			this._featuresMetadata = result.features.metadata;
		}
		if (result.jiraConnection) {
			this.jiraConnection = result.jiraConnection;
		}
		if (result.jiraIssues) {
			this.jiraIssues = result.jiraIssues;
		}
		if (result.jiraSync) {
			this.jiraSync = result.jiraSync;
		}
		if (result.jiraMappings) {
			this.jiraMappings = result.jiraMappings;
		}
	}

	private async persistJiraBinding(options: { profileId: string; projectKeys: readonly string[]; filterId?: string; jql?: string } | undefined): Promise<void> {
		const reference = this.currentContext ?? await this.contextResolverService.resolveContext();
		if (!reference) {
			return;
		}

		const manifest = reference.manifest ? this.cloneManifest(reference.manifest) : this.createDefaultManifest();
		if (!options) {
			delete manifest.productManager.tools.jira;
		} else {
			manifest.productManager.tools.jira = {
				enabled: true,
				autoRefresh: true,
				binding: {
					profileId: options.profileId,
					selectors: {
						projectKeys: [...options.projectKeys],
						filterId: options.filterId ?? '',
						jql: options.jql ?? '',
					},
				},
			};
		}

		await this.repoManifestService.saveManifest(reference, manifest);
	}

	private createDefaultManifest(): IProductManagerRepoManifest {
		return {
			version: 1,
			productManager: {
				tools: {
					features: {
						enabled: true,
						autoRefresh: true,
						binding: {
							selectors: {
								generator: 'complexity-estimator',
								mode: 'full',
								includeArchitecture: true,
								includeStories: true,
							},
						},
					},
				},
			},
		};
	}

	private cloneManifest(manifest: IProductManagerRepoManifest): IProductManagerRepoManifest {
		return JSON.parse(JSON.stringify(manifest)) as IProductManagerRepoManifest;
	}

	private updateJiraModel(): void {
		const projectKeys = this.currentContext?.bindings.jira?.selectors.projectKeys;
		const selectedProjects = Array.isArray(projectKeys) ? projectKeys.filter((value): value is string => typeof value === 'string') : [];
		const issueModels = this.jiraIssues.map(issue => ({
			issue,
			mapping: this.jiraMappings.find(candidate => candidate.issueKey === issue.key),
		}));
		const unmappedIssueCount = issueModels.filter(issue => !issue.mapping || issue.mapping.lanes.length === 0).length;
		this.jira = {
			summary: this.buildJiraSummary(),
			callToAction: this.jiraConnection.status === 'connected'
				? localize('jiraConnectedCallToAction', "Refresh Jira to import the latest backlog context.")
				: localize('jiraCallToAction', "Connect Jira to start importing backlog context."),
			checklist: [
				localize('jiraChecklistImport', "Import issues from CSV or API."),
				localize('jiraChecklistEstimator', "Attach estimator output per issue."),
				localize('jiraChecklistPrompts', "Open product-thread prompts directly from issue rows."),
			],
			connection: this.jiraConnection,
			sync: this.jiraSync,
			selectedProjects,
			issueCount: issueModels.length,
			issues: issueModels,
			unmappedIssueCount,
		};
	}

	private buildJiraSummary(): string {
		if (this.jiraConnection.status === 'connected') {
			if (this.jiraSync.status === 'syncing') {
				return localize('jiraSummarySyncing', "Jira is connected. Product Mode is syncing backlog issues now.");
			}
			if (this.jiraIssues.length > 0) {
				const unmappedIssueCount = this.jiraIssues.filter(issue => {
					const mapping = this.jiraMappings.find(candidate => candidate.issueKey === issue.key);
					return !mapping || mapping.lanes.length === 0;
				}).length;
				return localize('jiraSummaryConnected', "Jira is connected. Product Mode has imported {0} issues and mapped {1} of them onto the current product context.", this.jiraIssues.length, this.jiraIssues.length - unmappedIssueCount);
			}
			return localize('jiraSummaryConnectedNoIssues', "Jira is connected. Refresh the sync to import backlog issues for this product.");
		}

		if (this.jiraConnection.status === 'expired' || this.jiraConnection.status === 'error') {
			return this.jiraConnection.lastError ?? localize('jiraSummaryError', "Jira needs attention before Product Mode can import backlog context.");
		}

		return localize('jiraSummary', "Jira is not connected yet. Once connected, Product Mode will import issues, run the local complexity estimator, and render PM-readable summaries.");
	}

	private getIssueByKey(issueKey: string): IJiraIssue | undefined {
		return this.jiraIssues.find(issue => issue.key === issueKey);
	}

	private buildJiraIssueChatPrompt(issue: IJiraIssue, mapping?: IJiraMappingCandidate): string {
		const lanes = mapping?.lanes.length ? mapping.lanes.join(', ') : 'unmapped';
		return [
			`Help me reason about this Jira issue in Product Mode.`,
			`Issue: ${issue.key} — ${issue.summary}`,
			`Type: ${issue.issueType}`,
			`Status: ${issue.status}`,
			`Priority: ${issue.priority ?? 'n/a'}`,
			`Labels: ${issue.labels.join(', ') || 'none'}`,
			`Components: ${issue.components.join(', ') || 'none'}`,
			`Mapped feature: ${mapping?.featureTitle ?? 'none'}`,
			`Mapped lanes: ${lanes}`,
			`Description: ${issue.description || '(no description provided)'}`,
			`Please explain the likely product impact, delivery risk, and which architecture lanes are most relevant.`,
		].join('\n');
	}
}
