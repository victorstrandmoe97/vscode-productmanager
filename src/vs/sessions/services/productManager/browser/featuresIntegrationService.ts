/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { Position } from '../../../../editor/common/core/position.js';
import { SymbolKind } from '../../../../editor/common/languages.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { OutlineModel } from '../../../../editor/contrib/documentSymbols/browser/outlineModel.js';
import { getHoversPromise } from '../../../../editor/contrib/hover/browser/getHover.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ChatMessageRole, getTextResponseFromStream, ILanguageModelsService } from '../../../../workbench/contrib/chat/common/languageModels.js';
import { PRODUCT_MANAGER_REPOS_PATH_SETTING, IProductManagerArtifactsState, IProductManagerFeatureModel, IProductManagerFeaturesMetadata, IProductManagerLaneModel, IUserStory, ProductManagerLaneId } from '../common/productManager.js';
import { ProductManagerJsonObject } from '../common/repoManifest.js';
import { IResolvedProductManagerContext, IResolvedToolBinding, IToolBindingStateStoreService } from '../common/toolBindings.js';
import { IFeaturesIntegrationService, IFeaturesIntegrationState } from '../common/toolIntegration.js';

const LOG_PREFIX = '[FeaturesIntegrationService]';
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
const KNOWN_LANE_IDS = new Set<string>(['shared', 'application', 'presentation', 'entrypoint', 'ops', 'data', 'domain']);

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

export class FeaturesIntegrationService extends Disposable implements IFeaturesIntegrationService {

	declare readonly _serviceBrand: undefined;
	readonly toolId = 'features';

	constructor(
		@IToolBindingStateStoreService private readonly toolBindingStateStoreService: IToolBindingStateStoreService,
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
		@ITextModelService private readonly textModelService: ITextModelService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	async restoreState(binding: IResolvedToolBinding): Promise<IFeaturesIntegrationState | undefined> {
		return this.toolBindingStateStoreService.loadState<IFeaturesIntegrationState>(binding.cacheKey);
	}

	async refresh(
		context: IResolvedProductManagerContext,
		binding: IResolvedToolBinding,
		architecture: readonly IProductManagerLaneModel[],
		artifactsState: IProductManagerArtifactsState,
	): Promise<IFeaturesIntegrationState> {
		if (artifactsState.status !== 'ready' || architecture.length === 0) {
			throw new Error('Architecture must be ready before generating features.');
		}

		const selectors = binding.selectors;
		const includeStories = this.readBooleanSelector(selectors, 'includeStories', true);
		const mode = this.readStringSelector(selectors, 'mode', 'full');

		this.logService.info(`${LOG_PREFIX} refresh: repo=%s mode=%s includeStories=%s`, context.repoId, mode, includeStories);

		const laneContext = architecture
			.filter(lane => lane.files && lane.files.length > 0)
			.map(lane => {
				const fileList = (lane.files ?? []).slice(0, mode === 'quick' ? 30 : 60).join('\n  - ');
				return `${lane.id.toUpperCase()} (${lane.files?.length ?? 0} files):\n  - ${fileList}`;
			})
			.join('\n\n');

		const phase1SystemPrompt = `You are a senior product engineer analyzing a software repository.
Your task: identify ONLY distinct user-facing product features — not architectural layers, not internal utilities, not infrastructure.
A feature is something a real user or business stakeholder would recognise and care about.
Base your analysis strictly on the file paths provided.
Reply ONLY with a valid JSON array, no prose, no markdown fences.
Each element: {"title": "short feature name", "summary": "one sentence product description", "lanes": ["lane_id", ...]}`;

		const phase1UserPrompt = `Here are the repository files grouped by architectural lane:\n\n${laneContext}\n\nIdentify ${mode === 'quick' ? '4-6' : '4-10'} distinct product features this codebase implements.`;

		const rawFeatures = await this.callLLM<RawFeature[]>(phase1SystemPrompt, phase1UserPrompt);
		const { enriched: featureSymbols, totalSymbols, totalFiles } = await this.enrichFeaturesWithLSP(rawFeatures, architecture, context.repoId);
		const storiesByTitle = includeStories ? await this.generateUserStories(rawFeatures, featureSymbols) : new Map<string, readonly IUserStory[]>();

		const features = rawFeatures.map(feature => ({
			title: feature.title,
			summary: feature.summary,
			lanes: feature.lanes.filter(lane => KNOWN_LANE_IDS.has(lane)) as ProductManagerLaneId[],
			userStories: storiesByTitle.get(feature.title) ?? [],
		})) satisfies readonly IProductManagerFeatureModel[];

		const metadata: IProductManagerFeaturesMetadata = {
			discoveredAt: new Date().toISOString(),
			featureCount: features.length,
			userStoryCount: features.reduce((sum, feature) => sum + (feature.userStories?.length ?? 0), 0),
			symbolsProcessed: totalSymbols,
			filesProcessed: totalFiles,
			llmModel: 'copilot-fast',
		};

		const state = { features, metadata } satisfies IFeaturesIntegrationState;
		await this.toolBindingStateStoreService.saveState(binding.cacheKey, state);
		return state;
	}

	private async generateUserStories(rawFeatures: RawFeature[], featureSymbols: readonly EnrichedSymbol[][]): Promise<Map<string, readonly IUserStory[]>> {
		this.logService.info(`${LOG_PREFIX} generateUserStories: featureCount=%d`, rawFeatures.length);
		const featuresContext = rawFeatures.map((feature, index) => {
			const symbols = featureSymbols[index] ?? [];
			const symbolList = symbols.length > 0
				? symbols.map(symbol => `    - ${symbol.name} (${symbol.kind})${symbol.hoverText ? ': ' + symbol.hoverText.split('\n')[0] : ''}`).join('\n')
				: '    (no symbols resolved)';
			return `Feature: ${feature.title}\nSummary: ${feature.summary}\nLanes: ${feature.lanes.join(', ')}\nCode symbols:\n${symbolList}`;
		}).join('\n\n---\n\n');

		const phase3SystemPrompt = `You are a senior product engineer writing a product backlog.
For each feature, write 1-10 user stories based strictly on what the code symbols show the software actually does.
Use "As a [user], I want [action] so that [value]" format for each story.
Reply ONLY with a valid JSON array, no prose, no markdown fences.
Each element: {"featureTitle": "...", "stories": [{"title": "short name", "description": "As a..."}]}`;
		const phase3UserPrompt = `Here are the product features with their code symbols:\n\n${featuresContext}\n\nWrite user stories for each feature.`;

		try {
			const userStoriesResult = await this.callLLM<Array<{ featureTitle: string; stories: Array<{ title: string; description: string }> }>>(phase3SystemPrompt, phase3UserPrompt);
			const storiesByTitle = new Map<string, readonly IUserStory[]>();
			for (const entry of userStoriesResult) {
				if (entry.featureTitle && Array.isArray(entry.stories)) {
					storiesByTitle.set(entry.featureTitle, entry.stories.map(story => ({
						title: story.title ?? '',
						description: story.description ?? '',
					})));
				}
			}
			return storiesByTitle;
		} catch (error) {
			this.logService.error(`${LOG_PREFIX} generateUserStories: failed`, error);
			return new Map<string, readonly IUserStory[]>();
		}
	}

	private async enrichFeaturesWithLSP(
		features: readonly RawFeature[],
		architecture: readonly IProductManagerLaneModel[],
		repoId: string,
	): Promise<{ enriched: EnrichedSymbol[][]; totalSymbols: number; totalFiles: number }> {
		const reposPath = this.resolveReposPath();
		const laneFilesMap = new Map<string, readonly string[]>();
		for (const lane of architecture) {
			laneFilesMap.set(lane.id, lane.files ?? []);
		}

		const enriched: EnrichedSymbol[][] = [];
		let totalSymbols = 0;
		const processedFiles = new Set<string>();

		for (const feature of features) {
			const featureFiles = new Set<string>();
			for (const laneId of feature.lanes) {
				for (const file of laneFilesMap.get(laneId) ?? []) {
					featureFiles.add(file);
				}
			}

			const filesToQuery = [...featureFiles].slice(0, 20);
			const featureSymbols: EnrichedSymbol[] = [];
			for (const relativePath of filesToQuery) {
				processedFiles.add(relativePath);
				try {
					const fileUri = URI.file(`${reposPath}/${repoId}/${relativePath}`);
					const symbols = await this.getSymbolsWithHover(fileUri);
					featureSymbols.push(...symbols);
					totalSymbols += symbols.length;
				} catch (error) {
					this.logService.warn(`${LOG_PREFIX} enrichFeaturesWithLSP: skipping %s — %s`, relativePath, error);
				}
			}
			enriched.push(featureSymbols);
		}

		return { enriched, totalSymbols, totalFiles: processedFiles.size };
	}

	private async getSymbolsWithHover(uri: URI): Promise<EnrichedSymbol[]> {
		const cts = new CancellationTokenSource();
		const ref = await this.textModelService.createModelReference(uri);
		try {
			const model = ref.object.textEditorModel;
			const outlineModel = await OutlineModel.create(this.languageFeaturesService.documentSymbolProvider, model, cts.token);
			const docSymbols = outlineModel.asListOfDocumentSymbols();
			const candidates = docSymbols.filter(symbol => HOVER_SYMBOL_KINDS.has(symbol.kind)).slice(0, MAX_HOVER_SYMBOLS_PER_FILE);
			const enriched: EnrichedSymbol[] = [];

			for (const symbol of candidates) {
				const position = new Position(symbol.range.startLineNumber, symbol.range.startColumn);
				let hoverText = '';
				try {
					const hovers = await getHoversPromise(this.languageFeaturesService.hoverProvider, model, position, cts.token);
					hoverText = hovers
						.flatMap(hover => Array.isArray(hover.contents) ? hover.contents : [hover.contents])
						.map(content => typeof content === 'string' ? content : content.value)
						.join(' ')
						.replace(/\s+/g, ' ')
						.trim()
						.slice(0, 200);
				} catch {
					// hover enrichment is best-effort only
				}
				enriched.push({ name: symbol.name, kind: SYMBOL_KIND_NAMES[symbol.kind] ?? String(symbol.kind), hoverText });
			}

			return enriched;
		} finally {
			ref.dispose();
			cts.dispose();
		}
	}

	private resolveReposPath(): string {
		const configured = (this.configurationService.getValue<string>(PRODUCT_MANAGER_REPOS_PATH_SETTING) || '').trim();
		if (configured) {
			return configured.replace(/\/$/, '');
		}

		const folders = this.workspaceContextService.getWorkspace().folders;
		if (folders.length > 0) {
			return `${folders[0].uri.fsPath.replace(/\/$/, '')}/complexity-estimator/repos`;
		}

		return './complexity-estimator/repos';
	}

	private async callLLM<T>(systemPrompt: string, userPrompt: string): Promise<T> {
		const models = await this.languageModelsService.selectLanguageModels({ vendor: 'copilot', id: 'copilot-fast' });
		if (!models.length) {
			throw new Error('No copilot-fast model available');
		}

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
		const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
		return JSON.parse(cleaned) as T;
	}

	private readBooleanSelector(selectors: ProductManagerJsonObject, key: string, fallback: boolean): boolean {
		const value = selectors[key];
		return typeof value === 'boolean' ? value : fallback;
	}

	private readStringSelector(selectors: ProductManagerJsonObject, key: string, fallback: string): string {
		const value = selectors[key];
		return typeof value === 'string' && value ? value : fallback;
	}
}
