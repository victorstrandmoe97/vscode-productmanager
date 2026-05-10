/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IJiraConnectionState, IJiraMappingCandidate, IJiraSyncState, IProductManagerArtifactsState, IProductManagerFeatureModel, IProductManagerFeaturesMetadata, IProductManagerLaneModel } from './productManager.js';
import { IResolvedProductManagerContext, IResolvedToolBinding } from './toolBindings.js';
import { IJiraIssue } from './productManager.js';
import { IToolSearchResult } from './toolProfiles.js';

export type ToolRuntimeStatus = 'idle' | 'restored' | 'loading' | 'success' | 'error';

export interface IToolRuntimeState<TData> {
	readonly status: ToolRuntimeStatus;
	readonly source: 'cache' | 'live';
	readonly cacheKey: string;
	readonly lastSyncStartedAt?: string;
	readonly lastSyncCompletedAt?: string;
	readonly lastError?: string;
	readonly data?: TData;
}

export interface IToolIntegrationService<TState> {
	readonly toolId: string;

	restoreState(binding: IResolvedToolBinding): Promise<TState | undefined>;
	refresh(binding: IResolvedToolBinding): Promise<TState>;
	searchTargets?(binding: IResolvedToolBinding, query: string): Promise<readonly IToolSearchResult[]>;
}

export interface IFeaturesIntegrationState {
	readonly features: readonly IProductManagerFeatureModel[];
	readonly metadata?: IProductManagerFeaturesMetadata;
}

export interface IFeaturesIntegrationService {
	readonly _serviceBrand: undefined;
	readonly toolId: 'features';

	restoreState(binding: IResolvedToolBinding): Promise<IFeaturesIntegrationState | undefined>;
	refresh(context: IResolvedProductManagerContext, binding: IResolvedToolBinding, architecture: readonly IProductManagerLaneModel[], artifactsState: IProductManagerArtifactsState): Promise<IFeaturesIntegrationState>;
}

export interface IProductManagerActivationResult {
	readonly context?: IResolvedProductManagerContext;
	readonly features?: IFeaturesIntegrationState;
	readonly jiraConnection?: IJiraConnectionState;
	readonly jiraIssues?: readonly IJiraIssue[];
	readonly jiraSync?: IJiraSyncState;
	readonly jiraMappings?: readonly IJiraMappingCandidate[];
}

export interface IProductManagerActivationService {
	readonly _serviceBrand: undefined;

	restore(architecture: readonly IProductManagerLaneModel[], currentFeatures: readonly IProductManagerFeatureModel[]): Promise<IProductManagerActivationResult>;
	activate(architecture: readonly IProductManagerLaneModel[], artifactsState: IProductManagerArtifactsState): Promise<IProductManagerActivationResult>;
	refreshAll(architecture: readonly IProductManagerLaneModel[], artifactsState: IProductManagerArtifactsState): Promise<IProductManagerActivationResult>;
}

export const IFeaturesIntegrationService = createDecorator<IFeaturesIntegrationService>('featuresIntegrationService');
export const IProductManagerActivationService = createDecorator<IProductManagerActivationService>('productManagerActivationService');
