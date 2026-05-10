/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer, bufferToStream } from '../../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IRequestContext, IRequestOptions } from '../../../../../base/parts/request/common/request.js';
import { IRequestService } from '../../../../../platform/request/common/request.js';

interface IQueuedResponse {
	readonly method: string;
	readonly urlMatcher: RegExp;
	readonly response: () => IRequestContext;
}

export class StubRequestService implements Partial<IRequestService> {
	declare readonly _serviceBrand: undefined;

	private readonly queueEntries: IQueuedResponse[] = [];
	readonly requests: IRequestOptions[] = [];

	queue(method: string, urlMatcher: RegExp, response: () => IRequestContext): void {
		this.queueEntries.push({ method, urlMatcher, response });
	}

	async request(options: IRequestOptions, _token: CancellationToken): Promise<IRequestContext> {
		this.requests.push(options);
		const url = options.url ?? '';
		const method = options.type ?? 'GET';
		const idx = this.queueEntries.findIndex(entry => entry.method === method && entry.urlMatcher.test(url));
		if (idx === -1) {
			throw new Error(`No queued response for ${method} ${url}`);
		}

		const [entry] = this.queueEntries.splice(idx, 1);
		return entry.response();
	}
}

export function plainResponse(statusCode: number, body: VSBuffer = VSBuffer.alloc(0), headers: Record<string, string> = {}): () => IRequestContext {
	return () => ({
		res: {
			statusCode,
			headers,
		},
		stream: bufferToStream(body),
	});
}

export function jsonResponse(statusCode: number, body: unknown, headers: Record<string, string> = {}): () => IRequestContext {
	return plainResponse(statusCode, VSBuffer.fromString(JSON.stringify(body)), headers);
}
