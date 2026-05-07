/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import {
	IProductManagerArtifactsState,
	IProductManagerDataService,
	IProductManagerFeatureModel,
	IProductManagerJiraModel,
	IProductManagerLaneModel,
	IProductManagerMarketModel,
	IProductManagerOverviewModel,
	PRODUCT_MANAGER_ESTIMATOR_URL_SETTING,
	PRODUCT_MANAGER_REPO_ID_SETTING,
	PRODUCT_MANAGER_REPO_URL_SETTING,
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

const defaultFeatures: readonly IProductManagerFeatureModel[] = [
	{
		title: localize('workspaceUnderstandingTitle', "Workspace Understanding"),
		summary: localize('workspaceUnderstandingSummary', "Maps the repo into PM-readable lanes and feature groups instead of raw files."),
		lanes: ['entrypoint', 'application', 'presentation'],
	},
	{
		title: localize('deliveryIntakeTitle', "Delivery Intake"),
		summary: localize('deliveryIntakeSummary', "Connects incoming Jira work to the product map and estimator output."),
		lanes: ['application', 'domain', 'data'],
	},
	{
		title: localize('marketAwarenessTitle', "Market Awareness"),
		summary: localize('marketAwarenessSummary', "Surfaces competitor and market signals next to the current delivery plan."),
		lanes: ['application', 'shared'],
	},
];

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
	private features = defaultFeatures;
	private jira = defaultJira;
	private market = defaultMarket;

	/** In-memory GitHub credentials for the current session — used by recookAndRefresh. */
	private _githubToken: string | undefined;
	private _githubUsername: string | undefined;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
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

			// Strip the Docker-internal prefix "repos/{uuid}/" from every path so
			// only the repository-relative path is shown in the UI.
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
}
