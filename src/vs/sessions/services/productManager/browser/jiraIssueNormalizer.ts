/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IJiraFieldMap, IJiraIssue, IJiraIssueLink, IJiraUserSummary } from '../common/productManager.js';

interface IJiraRawUser {
	readonly accountId?: string;
	readonly displayName?: string;
	readonly emailAddress?: string;
}

interface IJiraRawIssueLink {
	readonly id?: string;
	readonly type?: {
		readonly inward?: string;
		readonly outward?: string;
		readonly name?: string;
	};
	readonly inwardIssue?: {
		readonly key: string;
		readonly fields?: {
			readonly summary?: string;
			readonly status?: { readonly name?: string };
		};
	};
	readonly outwardIssue?: {
		readonly key: string;
		readonly fields?: {
			readonly summary?: string;
			readonly status?: { readonly name?: string };
		};
	};
}

export interface IJiraRawIssue {
	readonly id: string;
	readonly key: string;
	readonly fields: Record<string, unknown> & {
		readonly summary?: string;
		readonly description?: unknown;
		readonly issuetype?: {
			readonly id?: string;
			readonly name?: string;
		};
		readonly status?: {
			readonly name?: string;
			readonly statusCategory?: {
				readonly name?: string;
			};
		};
		readonly priority?: {
			readonly name?: string;
		};
		readonly assignee?: IJiraRawUser | null;
		readonly reporter?: IJiraRawUser | null;
		readonly labels?: readonly string[];
		readonly components?: readonly { readonly name?: string }[];
		readonly parent?: {
			readonly key?: string;
		};
		readonly created?: string;
		readonly updated?: string;
		readonly issuelinks?: readonly IJiraRawIssueLink[];
	};
}

function normalizeUser(user: IJiraRawUser | null | undefined): IJiraUserSummary | undefined {
	if (!user?.displayName) {
		return undefined;
	}

	return {
		accountId: user.accountId,
		displayName: user.displayName,
		emailAddress: user.emailAddress,
	};
}

function normalizeIssueLinks(rawLinks: readonly IJiraRawIssueLink[] | undefined): readonly IJiraIssueLink[] {
	if (!rawLinks?.length) {
		return [];
	}

	const links: IJiraIssueLink[] = [];
	for (const link of rawLinks) {
		if (link.inwardIssue) {
			links.push({
				id: link.id,
				type: link.type?.inward ?? link.type?.name,
				direction: 'inward',
				key: link.inwardIssue.key,
				summary: link.inwardIssue.fields?.summary,
				status: link.inwardIssue.fields?.status?.name,
			});
			continue;
		}

		if (link.outwardIssue) {
			links.push({
				id: link.id,
				type: link.type?.outward ?? link.type?.name,
				direction: 'outward',
				key: link.outwardIssue.key,
				summary: link.outwardIssue.fields?.summary,
				status: link.outwardIssue.fields?.status?.name,
			});
		}
	}

	return links;
}

function extractAdfText(node: unknown): string {
	if (!node || typeof node !== 'object') {
		return '';
	}

	if (Array.isArray(node)) {
		return node.map(extractAdfText).filter(Boolean).join('\n').trim();
	}

	const candidate = node as {
		readonly type?: string;
		readonly text?: string;
		readonly content?: readonly unknown[];
	};

	if (candidate.type === 'text' && typeof candidate.text === 'string') {
		return candidate.text;
	}

	if (!candidate.content?.length) {
		return '';
	}

	const joined = candidate.content.map(extractAdfText).filter(Boolean).join(candidate.type === 'paragraph' ? ' ' : '\n');
	return joined.trim();
}

function readFieldValue<T>(fields: Record<string, unknown>, fieldId: string | undefined): T | undefined {
	if (!fieldId) {
		return undefined;
	}

	return fields[fieldId] as T | undefined;
}

function normalizeSprintNames(value: unknown): readonly string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.map(entry => {
		if (typeof entry === 'string') {
			return entry;
		}

		if (entry && typeof entry === 'object' && 'name' in entry && typeof entry.name === 'string') {
			return entry.name;
		}

		return undefined;
	}).filter((entry): entry is string => !!entry);
}

export function normalizeJiraIssue(raw: IJiraRawIssue, siteUrl: string, fieldMap: IJiraFieldMap): IJiraIssue {
	const storyPoints = readFieldValue<number | null>(raw.fields, fieldMap.storyPointsFieldId) ?? undefined;
	const epicLink = readFieldValue<string | null>(raw.fields, fieldMap.epicLinkFieldId) ?? undefined;
	const sprintNames = normalizeSprintNames(readFieldValue<unknown>(raw.fields, fieldMap.sprintFieldId));

	return {
		id: raw.id,
		key: raw.key,
		url: `${siteUrl.replace(/\/$/, '')}/browse/${raw.key}`,
		projectKey: raw.key.split('-')[0] ?? raw.key,
		summary: raw.fields.summary ?? '',
		description: extractAdfText(raw.fields.description),
		issueType: raw.fields.issuetype?.name ?? 'Issue',
		status: raw.fields.status?.name ?? 'Unknown',
		statusCategory: raw.fields.status?.statusCategory?.name,
		priority: raw.fields.priority?.name,
		assignee: normalizeUser(raw.fields.assignee),
		reporter: normalizeUser(raw.fields.reporter),
		labels: raw.fields.labels ?? [],
		components: (raw.fields.components ?? []).map(component => component.name ?? '').filter(Boolean),
		epicKey: epicLink,
		parentKey: raw.fields.parent?.key,
		sprintNames,
		storyPoints: typeof storyPoints === 'number' ? storyPoints : undefined,
		created: raw.fields.created ?? '',
		updated: raw.fields.updated ?? '',
		linkedIssues: normalizeIssueLinks(raw.fields.issuelinks),
	};
}

export function normalizeJiraIssues(rawIssues: readonly IJiraRawIssue[], siteUrl: string, fieldMap: IJiraFieldMap): readonly IJiraIssue[] {
	return rawIssues.map(rawIssue => normalizeJiraIssue(rawIssue, siteUrl, fieldMap));
}
