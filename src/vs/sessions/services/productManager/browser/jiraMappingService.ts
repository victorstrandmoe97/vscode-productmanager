/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IJiraMappingService } from '../common/jira.js';
import { IJiraIssue, IJiraMappingCandidate, IProductManagerFeatureModel, IProductManagerLaneModel, ProductManagerLaneId } from '../common/productManager.js';

const LOG_PREFIX = '[JiraMappingService]';

export class JiraMappingService extends Disposable implements IJiraMappingService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	async mapIssuesToProductContext(
		issues: readonly IJiraIssue[],
		features: readonly IProductManagerFeatureModel[],
		lanes: readonly IProductManagerLaneModel[],
	): Promise<readonly IJiraMappingCandidate[]> {
		const laneKeywordMap = new Map<ProductManagerLaneId, readonly string[]>();
		for (const lane of lanes) {
			laneKeywordMap.set(lane.id, this.tokenize(`${lane.title} ${lane.summary}`));
		}

		const mappings = issues.map(issue => {
			const issueTokens = new Set(this.tokenize([
				issue.summary,
				issue.description,
				issue.issueType,
				issue.labels.join(' '),
				issue.components.join(' '),
				issue.epicKey ?? '',
				issue.parentKey ?? '',
			].join(' ')));

			let bestFeature: IProductManagerFeatureModel | undefined;
			let bestFeatureScore = 0;
			for (const feature of features) {
				const score = this.computeOverlap(issueTokens, this.tokenize(`${feature.title} ${feature.summary}`));
				if (score > bestFeatureScore) {
					bestFeatureScore = score;
					bestFeature = feature;
				}
			}

			const laneScores = new Map<ProductManagerLaneId, number>();
			for (const [laneId, keywords] of laneKeywordMap) {
				laneScores.set(laneId, this.computeOverlap(issueTokens, keywords));
			}

			const rankedLanes = [...laneScores.entries()]
				.filter(([, score]) => score > 0)
				.sort((a, b) => b[1] - a[1])
				.slice(0, 2)
				.map(([laneId]) => laneId);

			const fallbackLanes = bestFeature?.lanes ?? [];
			const selectedLanes = rankedLanes.length > 0 ? rankedLanes : fallbackLanes;
			const confidence = Math.min(0.95, Math.max(bestFeatureScore, rankedLanes.length > 0 ? 0.55 : 0.25));
			const reason = bestFeature
				? `Matched Jira text to feature "${bestFeature.title}" with overlap score ${bestFeatureScore.toFixed(2)}.`
				: selectedLanes.length > 0
					? `Mapped via lane keyword overlap: ${selectedLanes.join(', ')}.`
					: 'No strong Product Mode match was found yet.';

			return {
				issueKey: issue.key,
				featureTitle: bestFeature?.title,
				lanes: selectedLanes,
				confidence,
				reason,
			} satisfies IJiraMappingCandidate;
		});

		this.logService.info(`${LOG_PREFIX} mapIssuesToProductContext: mapped %d issues`, mappings.length);
		return mappings;
	}

	private tokenize(value: string): readonly string[] {
		return value
			.toLowerCase()
			.split(/[^a-z0-9]+/g)
			.filter(token => token.length > 2);
	}

	private computeOverlap(source: ReadonlySet<string>, candidateTokens: readonly string[]): number {
		if (candidateTokens.length === 0) {
			return 0;
		}

		const distinctCandidateTokens = new Set(candidateTokens);
		let matches = 0;
		for (const token of distinctCandidateTokens) {
			if (source.has(token)) {
				matches++;
			}
		}

		return matches / distinctCandidateTokens.size;
	}
}
