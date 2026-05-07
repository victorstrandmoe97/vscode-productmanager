/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IFileService, FileOperationError, FileOperationResult } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import {
	IProductManagerArchitectureArtifact,
	IProductManagerArtifactsState,
	IProductManagerDataService,
	IProductManagerFeatureModel,
	IProductManagerFeaturesArtifact,
	IProductManagerJiraModel,
	IProductManagerLaneModel,
	IProductManagerManifest,
	IProductManagerMarketModel,
	IProductManagerOverviewModel,
	IProductManagerProjectSummaryArtifact,
	PRODUCT_MANAGER_ARCHITECTURE_FILE,
	PRODUCT_MANAGER_ESTIMATOR_URL_SETTING,
	PRODUCT_MANAGER_FEATURES_FILE,
	PRODUCT_MANAGER_MANIFEST_FILE,
	PRODUCT_MANAGER_PROJECT_SUMMARY_FILE,
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

function getDefaultArtifactsState(): IProductManagerArtifactsState {
	return {
		status: 'loading',
		message: localize('productArtifactsLoading', "Loading Product Mode artifacts..."),
	};
}

export class ProductManagerDataService extends Disposable implements IProductManagerDataService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private artifactsState: IProductManagerArtifactsState = getDefaultArtifactsState();
	private overview = defaultOverview;
	private architecture = defaultArchitecture;
	private features = defaultFeatures;
	private jira = defaultJira;
	private market = defaultMarket;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => void this.reload()));
		void this.reload();
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

	async connectRepository(repoUrl: string, githubToken?: string): Promise<void> {
		const baseUrl = (this.configurationService.getValue<string>(PRODUCT_MANAGER_ESTIMATOR_URL_SETTING) || 'http://localhost:8000').replace(/\/$/, '');

		// Derive a display name from the URL (e.g. "owner/repo")
		const urlMatch = repoUrl.replace(/\.git$/, '').match(/github\.com[/:](.+)/i);
		const name = urlMatch ? urlMatch[1] : repoUrl;

		this.logService.info('[ProductManagerDataService] connectRepository: url=%s', repoUrl);

		// Register or retrieve the repo
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

		// Persist repo_id and repo_url to user settings so they survive restarts
		await this.configurationService.updateValue(PRODUCT_MANAGER_REPO_ID_SETTING, repoId, ConfigurationTarget.USER);
		await this.configurationService.updateValue(PRODUCT_MANAGER_REPO_URL_SETTING, repoUrl, ConfigurationTarget.USER);
		this.logService.info('[ProductManagerDataService] connectRepository: saved repo_id and repo_url to user settings');

		// Trigger ingestion (clones repo + indexes files in graph engine)
		this.artifactsState = {
			status: 'loading',
			message: localize('ingestingRepo', "Indexing repository {0} — this may take a minute…", name),
		};
		this._onDidChange.fire();

		try {
			const ingestBody: Record<string, string> = {};
			if (githubToken) {
				// Extract username hint from token if possible; fall back to 'git' for PAT-based auth
				ingestBody['github_username'] = 'git';
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

		// Poll ingest status (max 5 minutes, 4-second intervals)
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

				// Show progress
				this.artifactsState = {
					status: 'loading',
					message: localize('ingestProgress', "Indexing {0} — phase: {1}…", name, status.phase ?? 'running'),
				};
				this._onDidChange.fire();
			} catch {
				// transient network error during poll, continue
			}
		}

		// Load architecture now that indexing is complete
		await this.fetchArchitectureFromApi();
	}

	async fetchArchitectureFromApi(): Promise<void> {
		const baseUrl = (this.configurationService.getValue<string>(PRODUCT_MANAGER_ESTIMATOR_URL_SETTING) || 'http://localhost:8000').replace(/\/$/, '');
		const repoId = this.configurationService.getValue<string>(PRODUCT_MANAGER_REPO_ID_SETTING) || '';

		if (!repoId) {
			this.logService.warn('[ProductManagerDataService] fetchArchitectureFromApi: sessions.productManager.repoId is not set — use "Connect Repository" to set it');
			this.artifactsState = {
				status: 'notGenerated',
				message: localize('productArtifactsNoRepoId', "Connect a GitHub repository to load the architecture map."),
			};
			this._onDidChange.fire();
			return;
		}

		this.logService.info('[ProductManagerDataService] fetchArchitectureFromApi: baseUrl=%s repoId=%s', baseUrl, repoId);

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

			const knownLaneIds = new Set<string>(['shared', 'application', 'presentation', 'entrypoint', 'ops', 'data', 'domain']);
			this.architecture = data.lanes.map(lane => {
				const laneId = knownLaneIds.has(lane.id) ? (lane.id as ProductManagerLaneId) : 'shared' as ProductManagerLaneId;
				const pct = Math.round(lane.weight * 100);
				return {
					id: laneId,
					title: lane.label,
					summary: lane.summary,
					coverageLabel: localize('coverageFromApi', "{0} files · {1}%", lane.file_count, pct),
					files: lane.files,
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

	private async reload(): Promise<void> {
		this.artifactsState = getDefaultArtifactsState();
		this._onDidChange.fire();

		const workspaceRoot = this.workspaceContextService.getWorkspace().folders[0]?.uri;
		if (!workspaceRoot) {
			this.applyDefaults({
				status: 'notGenerated',
				message: localize('productArtifactsNoWorkspace', "Open a repository to generate and persist Product Mode artifacts."),
			});
			return;
		}

		const artifactsRoot = joinPath(workspaceRoot, '.vscode', 'product-manager');
		const manifestResource = joinPath(artifactsRoot, PRODUCT_MANAGER_MANIFEST_FILE);
		const manifest = await this.readJsonIfExists<IProductManagerManifest>(manifestResource);
		if (!manifest) {
			this.applyDefaults({
				status: 'notGenerated',
				message: localize('productArtifactsMissing', "No Product Mode artifacts were found in `.vscode/product-manager` yet."),
			});
			return;
		}

		const projectSummaryResource = joinPath(artifactsRoot, manifest.artifacts?.projectSummary ?? PRODUCT_MANAGER_PROJECT_SUMMARY_FILE);
		const architectureResource = joinPath(artifactsRoot, manifest.artifacts?.architecture ?? PRODUCT_MANAGER_ARCHITECTURE_FILE);
		const featuresResource = joinPath(artifactsRoot, manifest.artifacts?.features ?? PRODUCT_MANAGER_FEATURES_FILE);

		const [projectSummary, architecture, features] = await Promise.all([
			this.readJsonIfExists<IProductManagerProjectSummaryArtifact>(projectSummaryResource),
			this.readJsonIfExists<IProductManagerArchitectureArtifact>(architectureResource),
			this.readJsonIfExists<IProductManagerFeaturesArtifact>(featuresResource),
		]);

		this.overview = this.mergeOverview(defaultOverview, projectSummary);
		this.architecture = architecture ? this.mergeArchitecture(defaultArchitecture, architecture) : defaultArchitecture;
		this.features = features ? this.mergeFeatures(defaultFeatures, features) : defaultFeatures;
		this.jira = defaultJira;
		this.market = defaultMarket;
		this.artifactsState = {
			status: 'ready',
			message: localize('productArtifactsReady', "Loaded persisted Product Mode artifacts from the repository."),
			generatedAt: manifest.generatedAt,
		};
		this._onDidChange.fire();
	}

	private applyDefaults(state: IProductManagerArtifactsState): void {
		this.overview = defaultOverview;
		this.architecture = defaultArchitecture;
		this.features = defaultFeatures;
		this.jira = defaultJira;
		this.market = defaultMarket;
		this.artifactsState = state;
		this._onDidChange.fire();
	}

	private mergeOverview(defaultValue: IProductManagerOverviewModel, artifact: IProductManagerProjectSummaryArtifact | undefined): IProductManagerOverviewModel {
		if (!artifact) {
			return defaultValue;
		}

		return {
			title: artifact.title || defaultValue.title,
			summary: artifact.summary || defaultValue.summary,
			highlights: artifact.highlights?.length ? artifact.highlights : defaultValue.highlights,
		};
	}

	private mergeArchitecture(defaultValue: readonly IProductManagerLaneModel[], artifact: IProductManagerArchitectureArtifact): readonly IProductManagerLaneModel[] {
		const artifactsById = new Map<ProductManagerLaneId, IProductManagerArchitectureArtifact['lanes'][number]>();
		for (const lane of artifact.lanes) {
			artifactsById.set(lane.id, lane);
		}

		return defaultValue.map(lane => {
			const persistedLane = artifactsById.get(lane.id);
			if (!persistedLane) {
				return lane;
			}

			return {
				id: lane.id,
				title: persistedLane.label || persistedLane.title || lane.title,
				summary: persistedLane.summary || lane.summary,
				coverageLabel: persistedLane.coverageLabel || this.formatCoverageLabel(persistedLane.coverage) || lane.coverageLabel,
			};
		});
	}

	private mergeFeatures(defaultValue: readonly IProductManagerFeatureModel[], artifact: IProductManagerFeaturesArtifact): readonly IProductManagerFeatureModel[] {
		const persistedFeatures = artifact.features
			.filter(feature => !!feature.name || !!feature.title)
			.map(feature => ({
				title: feature.name || feature.title || localize('unnamedFeature', "Unnamed Feature"),
				summary: feature.summary || localize('featureSummaryMissing', "No persisted summary yet."),
				lanes: feature.lanes?.length ? feature.lanes : ([] as readonly ProductManagerLaneId[]),
			}));

		return persistedFeatures.length ? persistedFeatures : defaultValue;
	}

	private formatCoverageLabel(coverage: IProductManagerArchitectureArtifact['lanes'][number]['coverage']): string | undefined {
		if (!coverage) {
			return undefined;
		}

		const segments: string[] = [];
		if (typeof coverage.fileCount === 'number') {
			segments.push(localize('coverageFilesCount', "{0} files", coverage.fileCount));
		}
		if (typeof coverage.moduleCount === 'number') {
			segments.push(localize('coverageModulesCount', "{0} modules", coverage.moduleCount));
		}
		if (typeof coverage.estimatedWeight === 'number') {
			segments.push(localize('coverageWeightCount', "{0}% weight", Math.round(coverage.estimatedWeight * 100)));
		}

		return segments.length ? segments.join(' • ') : undefined;
	}

	private async readJsonIfExists<T>(resource: URI): Promise<T | undefined> {
		try {
			const content = await this.fileService.readFile(resource);
			return JSON.parse(content.value.toString()) as T;
		} catch (error) {
			if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				return undefined;
			}

			this.logService.warn('Failed to read Product Mode artifact', resource.toString(), error);
			return undefined;
		}
	}
}
