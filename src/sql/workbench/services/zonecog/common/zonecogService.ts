/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export const IZoneCogService = createDecorator<IZoneCogService>('zonecogService');

/**
 * Zone-Cog cognitive protocol interface for embodied cognition workbench
 */
export interface IZoneCogService {
	readonly _serviceBrand: undefined;

	/**
	 * Initialize the Zone-Cog cognitive framework
	 */
	initialize(): Promise<void>;

	/**
	 * Process a query through the Zone-Cog thinking protocol
	 * @param query The human query to process
	 * @returns The response after comprehensive cognitive processing
	 */
	processQuery(query: string): Promise<ZoneCogResponse>;

	/**
	 * Get the current cognitive state of the Zone-Cog system
	 */
	getCognitiveState(): ZoneCogState;

	/**
	 * Enable or disable the comprehensive thinking mode
	 */
	setThinkingMode(enabled: boolean): void;
}

/**
 * Response from Zone-Cog cognitive processing
 */
export interface ZoneCogResponse {
	/**
	 * The thinking process (internal monologue) - hidden from user
	 */
	thinking: string;

	/**
	 * The final response to the human
	 */
	response: string;

	/**
	 * Confidence level in the response (0-1)
	 */
	confidence: number;

	/**
	 * Processing metadata
	 */
	metadata: {
		queryComplexity: 'simple' | 'moderate' | 'complex';
		thinkingDepth: 'shallow' | 'moderate' | 'deep';
		processingTime: number;
	};
}

/**
 * Current cognitive state of the Zone-Cog system
 */
export interface ZoneCogState {
	isInitialized: boolean;
	thinkingModeEnabled: boolean;
	currentContext: string | null;
	cognitiveLoad: number; // 0-1 scale
}