/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { TruthValue } from 'sql/workbench/services/zonecog/common/plnReasoning';

export const IHyperonService = createDecorator<IHyperonService>('hyperonService');

// ---------------------------------------------------------------------------
// MeTTa atom model (OpenCog Hyperon)
// ---------------------------------------------------------------------------

/**
 * A MeTTa atom. Mirrors Hyperon's four atom kinds:
 *  - `symbol` - a named symbol, e.g. `foo`, `=`, `&self`;
 *  - `variable` - a pattern variable, written `$name` in MeTTa source;
 *  - `grounded` - a grounded value (number, string, or boolean);
 *  - `expression` - an ordered composition of atoms, written `(a b c)`.
 */
export type MeTTaAtom =
	| { kind: 'symbol'; name: string }
	| { kind: 'variable'; name: string }
	| { kind: 'grounded'; value: number | string | boolean }
	| { kind: 'expression'; children: MeTTaAtom[] };

/** Result of one `!`-directive inside a MeTTa program. */
export interface MeTTaDirectiveResult {
	/** Rendered source of the directive's expression. */
	source: string;
	/** The (possibly nondeterministic) evaluation results. */
	results: MeTTaAtom[];
	/** Rendered textual forms of `results`. */
	rendered: string[];
}

/** Outcome of running a MeTTa program. */
export interface MeTTaRunResult {
	/** One entry per `!`-directive, in program order. */
	directives: MeTTaDirectiveResult[];
	/** Count of non-directive top-level atoms added to the program space. */
	atomsAdded: number;
	/** Total evaluation steps consumed. */
	steps: number;
	/** Evaluation errors encountered (division by zero, budget exhaustion, ...). */
	errors: string[];
	durationMs: number;
}

export interface HyperonSpaceStats {
	/** Total atoms in the persistent space (facts + rules). */
	atomCount: number;
	/** Atoms that are rewrite rules, i.e. `(= <pattern> <result>)`. */
	ruleCount: number;
}

// ---------------------------------------------------------------------------
// PLN-over-MeTTa (native URE execution) types
// ---------------------------------------------------------------------------

/** A conclusion derived by MeTTa-native PLN inference and persisted to the hypergraph. */
export interface MettaInferredConclusion {
	/** Hypergraph link id the conclusion was persisted as. */
	linkId: string;
	from: string;
	to: string;
	truthValue: TruthValue;
	/** Hypergraph link ids of the premises the conclusion was derived from. */
	premises: string[];
}

export interface MettaPLNResult {
	inferred: MettaInferredConclusion[];
	/** Raw conclusion expressions produced by the MeTTa program before filtering. */
	conclusionsExamined: number;
	steps: number;
	durationMs: number;
	errors: string[];
}

export interface MettaPLNOptions {
	/** Conclusions with confidence below this are discarded. Default 0.05. */
	minConfidence?: number;
	/** Maximum conclusions persisted per run. Default 200. */
	maxConclusions?: number;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * OpenCog Hyperon MeTTa integration service (Phase B.2).
 *
 * Embeds a MeTTa interpreter over a persistent atom space: programs are
 * parsed from MeTTa source, `(= pattern result)` equalities act as
 * nondeterministic rewrite rules, `!`-directives are evaluated (with
 * grounded arithmetic/comparison/logic operations and the `match`, `if`,
 * and `quote` special forms), and results are returned as structured
 * atoms. Bidirectional binding converts between TypeScript values and
 * MeTTa atoms, the hypergraph store can be imported as MeTTa facts, and
 * `runPLNDeduction` executes the PLN deduction rule natively in MeTTa -
 * feeding derived truth values back into the PLN reasoning service and
 * persisting conclusions as hypergraph links so the URE forward-chainer
 * builds on them.
 */
export interface IHyperonService {
	readonly _serviceBrand: undefined;

	/** Fired after every `run()` completes. */
	readonly onDidRunProgram: Event<MeTTaRunResult>;

	/** Parse MeTTa source into atoms without evaluating or storing them. */
	parse(source: string): MeTTaAtom[];

	/**
	 * Run a MeTTa program: non-directive top-level atoms are added to a
	 * transient space layered over the persistent space, and each
	 * `!`-directive is evaluated in order against it. The persistent space
	 * is not modified.
	 */
	run(source: string): MeTTaRunResult;

	/**
	 * Parse MeTTa source and add its top-level atoms (facts and `=` rules)
	 * to the persistent space. Returns the number of atoms added.
	 * `!`-directives are not allowed here - use `run()`.
	 */
	addToSpace(source: string): number;

	/**
	 * Match a single pattern against the persistent space and instantiate
	 * the template for every consistent grounding (the `match` primitive
	 * exposed directly). Both arguments are MeTTa source for one atom each.
	 */
	query(patternSource: string, templateSource: string): MeTTaAtom[];

	/** Remove every atom from the persistent space. */
	resetSpace(): void;

	getSpaceStats(): HyperonSpaceStats;

	/** Render an atom back to canonical MeTTa source text. */
	renderAtom(atom: MeTTaAtom): string;

	// -- Bidirectional TypeScript ↔ MeTTa binding ------------------------------

	/**
	 * Convert a TypeScript value to a MeTTa atom: numbers/booleans/strings
	 * become grounded atoms, arrays become expressions, and plain objects
	 * become expressions of `(key value)` pair expressions.
	 */
	jsToAtom(value: unknown): MeTTaAtom;

	/**
	 * Convert a MeTTa atom to a TypeScript value: grounded atoms unwrap to
	 * their value, symbols/variables to their rendered name, and
	 * expressions to arrays of converted children.
	 */
	atomToJs(atom: MeTTaAtom): unknown;

	/**
	 * Import the hypergraph store into the persistent space as MeTTa facts:
	 * `(node <type> <id> <content>)` and `(prior <id> <salience>)` for every
	 * node, and `(link <linkId> <from> <to> <strength> <confidence>)` for
	 * every binary link (truth values sourced from the PLN reasoning
	 * service). Returns the number of atoms added.
	 */
	importHypergraph(): number;

	/**
	 * Execute the PLN deduction rule natively in MeTTa over the current
	 * hypergraph (A→B, B→C |- A→C with the full strength formula using node
	 * salience priors), persist each surviving conclusion as an `Inferred`
	 * hypergraph link, and register its truth value with the PLN reasoning
	 * service so subsequent URE passes build on the MeTTa-derived results.
	 */
	runPLNDeduction(options?: MettaPLNOptions): MettaPLNResult;
}
