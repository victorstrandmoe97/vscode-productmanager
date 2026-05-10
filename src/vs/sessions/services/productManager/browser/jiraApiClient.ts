/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { asJson, asText, IRequestService } from '../../../../platform/request/common/request.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IJiraApiClient, IJiraAuthSession, IJiraSearchRequest } from '../common/jira.js';
import { IJiraFieldMap, IJiraIssuePage, IJiraProjectSummary, PRODUCT_MANAGER_ESTIMATOR_URL_SETTING } from '../common/productManager.js';
import { IJiraRawIssue, normalizeJiraIssues } from './jiraIssueNormalizer.js';

const LOG_PREFIX = '[JiraApiClient]';
const DEFAULT_MAX_RESULTS = 50;

interface IJiraFieldDefinition {
	readonly id: string;
	readonly name: string;
	readonly schema?: {
		readonly custom?: string;
	};
}

interface IJiraSearchResponse {
	readonly issues?: readonly IJiraRawIssue[];
	readonly maxResults?: number;
	readonly total?: number;
	readonly nextPageToken?: string;
	readonly isLast?: boolean;
}

interface IJiraProjectSearchResponse {
	readonly values?: Array<{
		readonly id: string;
		readonly key: string;
		readonly name: string;
	}>;
}

export class JiraApiError extends Error {
	constructor(
		message: string,
		readonly statusCode: number,
		readonly retryAfterSeconds?: number,
	) {
		super(message);
		this.name = 'JiraApiError';
	}
}

export class JiraApiClient extends Disposable implements IJiraApiClient {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IRequestService private readonly requestService: IRequestService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	async getAccessibleProjects(session: IJiraAuthSession): Promise<readonly IJiraProjectSummary[]> {
		const response = await this.request<IJiraProjectSearchResponse>(session, '/api/jira/projects', 'productManager.jira.projects');
		return (response.values ?? []).map(project => ({
			id: project.id,
			key: project.key,
			name: project.name,
		}));
	}

	async getFieldMap(session: IJiraAuthSession): Promise<IJiraFieldMap> {
		const fields = await this.request<readonly IJiraFieldDefinition[]>(session, '/api/jira/fields', 'productManager.jira.fields');
		const findFieldId = (matcher: (field: IJiraFieldDefinition) => boolean): string | undefined => fields.find(matcher)?.id;

		return {
			storyPointsFieldId: findFieldId(field => /story points/i.test(field.name)),
			epicLinkFieldId: findFieldId(field => /epic link/i.test(field.name)),
			sprintFieldId: findFieldId(field => /sprint/i.test(field.name)),
			teamFieldId: findFieldId(field => /team/i.test(field.name)),
		};
	}

	async searchIssues(session: IJiraAuthSession, request: IJiraSearchRequest): Promise<IJiraIssuePage> {
		const fieldMap = await this.getFieldMap(session);
		const response = await this.request<IJiraSearchResponse>(
			session,
			'/api/jira/search',
			'productManager.jira.search',
			this.buildSearchBody(request, fieldMap),
		);
		const issues = normalizeJiraIssues(response.issues ?? [], session.siteUrl, fieldMap);
		const total = response.total ?? issues.length;
		const nextPageToken = response.isLast ? undefined : response.nextPageToken;

		return {
			issues,
			nextPageToken,
			total,
		};
	}

	private async request<T>(session: IJiraAuthSession, path: string, callSite: string, data?: unknown): Promise<T> {
		const url = `${this.getProxyBaseUrl()}${path}`;
		this.logService.trace(`${LOG_PREFIX} POST ${path}`);

		const context = await this.requestService.request({
			type: 'POST',
			url,
			headers: {
				'Accept': 'application/json',
				'Content-Type': 'application/json',
			},
			data: JSON.stringify({
				site_url: session.siteUrl,
				email: session.email,
				api_token: session.apiToken,
				...(data && typeof data === 'object' ? data as Record<string, unknown> : {}),
			}),
			callSite,
		}, CancellationToken.None);

		const statusCode = context.res.statusCode ?? 0;
		if (statusCode < 200 || statusCode >= 300) {
			const retryAfter = this.parseRetryAfter(context.res.headers?.['retry-after']);
			const body = await asText(context).catch(() => '') ?? '';
			this.logService.error(`${LOG_PREFIX} POST ${path} failed: status=%d`, statusCode);
			throw new JiraApiError(body || `Jira API request failed for ${path}`, statusCode, retryAfter);
		}

		const parsed = await asJson<T>(context);
		if (parsed === null) {
			throw new JiraApiError(`Jira API returned no body for ${path}`, statusCode);
		}

		return parsed;
	}

	private parseRetryAfter(value: string | string[] | undefined): number | undefined {
		if (value === undefined) {
			return undefined;
		}

		const raw = Array.isArray(value) ? value[0] : value;
		const parsed = parseInt(raw, 10);
		return isNaN(parsed) ? undefined : parsed;
	}

	private buildSearchBody(request: IJiraSearchRequest, fieldMap: IJiraFieldMap): unknown {
		const fields = [
			'summary',
			'description',
			'issuetype',
			'status',
			'priority',
			'assignee',
			'reporter',
			'labels',
			'components',
			'parent',
			'created',
			'updated',
			'issuelinks',
			fieldMap.storyPointsFieldId,
			fieldMap.epicLinkFieldId,
			fieldMap.sprintFieldId,
			fieldMap.teamFieldId,
		].filter((field): field is string => !!field);

		return {
			project_keys: [...request.projectKeys],
			filter_id: request.filterId,
			jql: request.jql,
			max_results: request.maxResults ?? DEFAULT_MAX_RESULTS,
			next_page_token: request.nextPageToken,
			updated_since: request.updatedSince,
			field_ids: fields,
			fields_by_keys: false,
		};
	}

	private getProxyBaseUrl(): string {
		return (this.configurationService.getValue<string>(PRODUCT_MANAGER_ESTIMATOR_URL_SETTING) || 'http://localhost:8000').replace(/\/$/, '');
	}
}
