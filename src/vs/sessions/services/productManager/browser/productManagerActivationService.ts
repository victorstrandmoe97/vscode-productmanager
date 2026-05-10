/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IJiraAuthService, IJiraMappingService, IJiraSyncService } from '../common/jira.js';
import { IProductManagerActivationResult, IProductManagerActivationService, IFeaturesIntegrationService } from '../common/toolIntegration.js';
import { IContextResolverService } from '../common/toolBindings.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IProductManagerArtifactsState, IProductManagerFeatureModel, IProductManagerLaneModel } from '../common/productManager.js';

const LOG_PREFIX = '[ProductManagerActivationService]';

export class ProductManagerActivationService extends Disposable implements IProductManagerActivationService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IContextResolverService private readonly contextResolverService: IContextResolverService,
		@IFeaturesIntegrationService private readonly featuresIntegrationService: IFeaturesIntegrationService,
		@IJiraAuthService private readonly jiraAuthService: IJiraAuthService,
		@IJiraSyncService private readonly jiraSyncService: IJiraSyncService,
		@IJiraMappingService private readonly jiraMappingService: IJiraMappingService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	async restore(architecture: readonly IProductManagerLaneModel[], currentFeatures: readonly IProductManagerFeatureModel[]): Promise<IProductManagerActivationResult> {
		const context = await this.contextResolverService.resolveContext();
		if (!context) {
			return {};
		}

		let features = undefined;
		let jiraConnection = undefined;
		let jiraIssues = undefined;
		let jiraSync = undefined;
		let jiraMappings = undefined;
		const featureBinding = context.bindings.features;
		if (featureBinding) {
			features = await this.featuresIntegrationService.restoreState(featureBinding);
		}

		const jiraBinding = context.bindings.jira;
		if (jiraBinding) {
			jiraConnection = await this.jiraAuthService.getConnectionState(jiraBinding.profile?.id ?? jiraBinding.binding?.profileId);
			const jiraState = await this.jiraSyncService.restore(jiraBinding);
			if (jiraState) {
				jiraIssues = jiraState.issues;
				jiraSync = jiraState.sync;
				if ((features?.features ?? currentFeatures).length > 0 && architecture.length > 0) {
					jiraMappings = await this.jiraMappingService.mapIssuesToProductContext(jiraState.issues, features?.features ?? currentFeatures, architecture);
				}
			}
		}

		return { context, features, jiraConnection, jiraIssues, jiraSync, jiraMappings };
	}

	async activate(architecture: readonly IProductManagerLaneModel[], artifactsState: IProductManagerArtifactsState): Promise<IProductManagerActivationResult> {
		const context = await this.contextResolverService.resolveContext();
		if (!context) {
			return {};
		}

		this.logService.info(`${LOG_PREFIX} activate: repo=%s`, context.repoId);
		let features = undefined;
		let jiraConnection = undefined;
		let jiraIssues = undefined;
		let jiraSync = undefined;
		let jiraMappings = undefined;
		const featureBinding = context.bindings.features;
		if (featureBinding?.enabled && featureBinding.autoRefresh) {
			features = await this.featuresIntegrationService.refresh(context, featureBinding, architecture, artifactsState);
		} else if (featureBinding) {
			features = await this.featuresIntegrationService.restoreState(featureBinding);
		}

		const jiraBinding = context.bindings.jira;
		if (jiraBinding) {
			jiraConnection = await this.jiraAuthService.validateSession(jiraBinding.profile?.id ?? jiraBinding.binding?.profileId);
			if (jiraBinding.enabled && jiraBinding.autoRefresh && jiraConnection.status === 'connected') {
				const jiraState = await this.jiraSyncService.refresh(jiraBinding, { full: true });
				jiraIssues = jiraState.issues;
				jiraSync = jiraState.sync;
				if ((features?.features ?? []).length > 0 && architecture.length > 0) {
					jiraMappings = await this.jiraMappingService.mapIssuesToProductContext(jiraState.issues, features?.features ?? [], architecture);
				}
			} else {
				const jiraState = await this.jiraSyncService.restore(jiraBinding);
				jiraIssues = jiraState?.issues;
				jiraSync = jiraState?.sync;
			}
		}

		return { context, features, jiraConnection, jiraIssues, jiraSync, jiraMappings };
	}

	async refreshAll(architecture: readonly IProductManagerLaneModel[], artifactsState: IProductManagerArtifactsState): Promise<IProductManagerActivationResult> {
		return this.activate(architecture, artifactsState);
	}
}
