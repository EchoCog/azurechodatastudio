/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import {
	IHyperonService, MeTTaAtom, MeTTaRunResult, MeTTaDirectiveResult, HyperonSpaceStats,
	MettaPLNOptions, MettaPLNResult, MettaInferredConclusion
} from 'sql/workbench/services/zonecog/common/hyperon';
import { IHypergraphStore, ICognitiveMembraneService, HypergraphLink } from 'sql/workbench/services/zonecog/common/zonecogService';
import { IPLNReasoningService, TruthValue } from 'sql/workbench/services/zonecog/common/plnReasoning';

// ---------------------------------------------------------------------------
// Interpreter limits
// ---------------------------------------------------------------------------

/** Maximum evaluation steps per program run before aborting. */
const DEFAULT_STEP_BUDGET = 250000;
/** Maximum evaluation recursion depth. */
const MAX_EVAL_DEPTH = 256;
/** Cap on nondeterministic argument combinations per expression evaluation. */
const MAX_COMBINATIONS = 1024;

/** Top-level program element: an atom, optionally flagged as a `!`-directive. */
interface ProgramElement {
	directive: boolean;
	atom: MeTTaAtom;
}

/** Shared evaluation context threading the step budget and error log. */
interface EvalContext {
	steps: number;
	errors: string[];
	budgetExceeded: boolean;
	depthExceeded: boolean;
	comboTruncated: boolean;
}

type Bindings = Map<string, MeTTaAtom>;

// ---------------------------------------------------------------------------
// Tokenizer / parser (exported for tests)
// ---------------------------------------------------------------------------

interface Token {
	kind: 'lparen' | 'rparen' | 'bang' | 'string' | 'word';
	text: string;
}

export function tokenizeMeTTa(source: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	const n = source.length;
	while (i < n) {
		const ch = source[i];
		if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
			i++;
			continue;
		}
		if (ch === ';') {
			while (i < n && source[i] !== '\n') {
				i++;
			}
			continue;
		}
		if (ch === '(') {
			tokens.push({ kind: 'lparen', text: '(' });
			i++;
			continue;
		}
		if (ch === ')') {
			tokens.push({ kind: 'rparen', text: ')' });
			i++;
			continue;
		}
		if (ch === '!') {
			tokens.push({ kind: 'bang', text: '!' });
			i++;
			continue;
		}
		if (ch === '"') {
			let value = '';
			i++;
			let closed = false;
			while (i < n) {
				const c = source[i];
				if (c === '\\' && i + 1 < n) {
					const next = source[i + 1];
					if (next === 'n') {
						value += '\n';
					} else if (next === 't') {
						value += '\t';
					} else if (next === 'r') {
						value += '\r';
					} else {
						value += next;
					}
					i += 2;
					continue;
				}
				if (c === '"') {
					closed = true;
					i++;
					break;
				}
				value += c;
				i++;
			}
			if (!closed) {
				throw new Error('MeTTa parse error: unterminated string literal');
			}
			tokens.push({ kind: 'string', text: value });
			continue;
		}
		let word = '';
		while (i < n) {
			const c = source[i];
			if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '(' || c === ')' || c === ';' || c === '"') {
				break;
			}
			word += c;
			i++;
		}
		tokens.push({ kind: 'word', text: word });
	}
	return tokens;
}

const NUMBER_PATTERN = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function wordToAtom(word: string): MeTTaAtom {
	if (word.startsWith('$') && word.length > 1) {
		return { kind: 'variable', name: word.substring(1) };
	}
	if (word === 'True') {
		return { kind: 'grounded', value: true };
	}
	if (word === 'False') {
		return { kind: 'grounded', value: false };
	}
	if (NUMBER_PATTERN.test(word)) {
		return { kind: 'grounded', value: parseFloat(word) };
	}
	return { kind: 'symbol', name: word };
}

export function parseMeTTaProgram(source: string): ProgramElement[] {
	const tokens = tokenizeMeTTa(source);
	const elements: ProgramElement[] = [];
	let pos = 0;

	const parseAtom = (): MeTTaAtom => {
		if (pos >= tokens.length) {
			throw new Error('MeTTa parse error: unexpected end of input');
		}
		const token = tokens[pos];
		if (token.kind === 'lparen') {
			pos++;
			const children: MeTTaAtom[] = [];
			while (pos < tokens.length && tokens[pos].kind !== 'rparen') {
				children.push(parseAtom());
			}
			if (pos >= tokens.length) {
				throw new Error('MeTTa parse error: missing closing parenthesis');
			}
			pos++;
			return { kind: 'expression', children };
		}
		if (token.kind === 'rparen') {
			throw new Error('MeTTa parse error: unexpected closing parenthesis');
		}
		if (token.kind === 'bang') {
			throw new Error('MeTTa parse error: `!` is only allowed at the top level');
		}
		pos++;
		if (token.kind === 'string') {
			return { kind: 'grounded', value: token.text };
		}
		return wordToAtom(token.text);
	};

	while (pos < tokens.length) {
		if (tokens[pos].kind === 'bang') {
			pos++;
			elements.push({ directive: true, atom: parseAtom() });
		} else {
			elements.push({ directive: false, atom: parseAtom() });
		}
	}
	return elements;
}

// ---------------------------------------------------------------------------
// Rendering, equality, substitution, unification (exported for tests)
// ---------------------------------------------------------------------------

export function renderMeTTaAtom(atom: MeTTaAtom): string {
	switch (atom.kind) {
		case 'symbol':
			return atom.name;
		case 'variable':
			return '$' + atom.name;
		case 'grounded':
			if (typeof atom.value === 'string') {
				return JSON.stringify(atom.value);
			}
			if (typeof atom.value === 'boolean') {
				return atom.value ? 'True' : 'False';
			}
			return String(atom.value);
		case 'expression':
			return '(' + atom.children.map(renderMeTTaAtom).join(' ') + ')';
	}
}

export function atomsEqual(a: MeTTaAtom, b: MeTTaAtom): boolean {
	if (a.kind !== b.kind) {
		return false;
	}
	switch (a.kind) {
		case 'symbol':
			return a.name === (b as { kind: 'symbol'; name: string }).name;
		case 'variable':
			return a.name === (b as { kind: 'variable'; name: string }).name;
		case 'grounded':
			return a.value === (b as { kind: 'grounded'; value: number | string | boolean }).value;
		case 'expression': {
			const bc = (b as { kind: 'expression'; children: MeTTaAtom[] }).children;
			if (a.children.length !== bc.length) {
				return false;
			}
			for (let i = 0; i < a.children.length; i++) {
				if (!atomsEqual(a.children[i], bc[i])) {
					return false;
				}
			}
			return true;
		}
	}
}

/** Resolve a variable through the binding chain to its final value. */
function walk(atom: MeTTaAtom, bindings: Bindings): MeTTaAtom {
	let current = atom;
	while (current.kind === 'variable') {
		const bound = bindings.get(current.name);
		if (!bound) {
			return current;
		}
		current = bound;
	}
	return current;
}

/** Deep-substitute all bound variables in an atom. */
export function substituteBindings(atom: MeTTaAtom, bindings: Bindings): MeTTaAtom {
	const resolved = walk(atom, bindings);
	if (resolved.kind === 'expression') {
		return { kind: 'expression', children: resolved.children.map(c => substituteBindings(c, bindings)) };
	}
	return resolved;
}

/** True if `variable` occurs anywhere inside `atom` (after walking bindings). */
function occurs(variableName: string, atom: MeTTaAtom, bindings: Bindings): boolean {
	const resolved = walk(atom, bindings);
	if (resolved.kind === 'variable') {
		return resolved.name === variableName;
	}
	if (resolved.kind === 'expression') {
		return resolved.children.some(c => occurs(variableName, c, bindings));
	}
	return false;
}

/**
 * Syntactic unification of two atoms. Variables on either side may bind.
 * Returns the extended bindings, or undefined if the atoms do not unify.
 */
export function unifyAtoms(a: MeTTaAtom, b: MeTTaAtom, bindings: Bindings): Bindings | undefined {
	const left = walk(a, bindings);
	const right = walk(b, bindings);
	if (left.kind === 'variable' && right.kind === 'variable' && left.name === right.name) {
		return bindings;
	}
	if (left.kind === 'variable') {
		if (occurs(left.name, right, bindings)) {
			return undefined;
		}
		const extended = new Map(bindings);
		extended.set(left.name, right);
		return extended;
	}
	if (right.kind === 'variable') {
		if (occurs(right.name, left, bindings)) {
			return undefined;
		}
		const extended = new Map(bindings);
		extended.set(right.name, left);
		return extended;
	}
	if (left.kind === 'symbol' && right.kind === 'symbol') {
		return left.name === right.name ? bindings : undefined;
	}
	if (left.kind === 'grounded' && right.kind === 'grounded') {
		return left.value === right.value ? bindings : undefined;
	}
	if (left.kind === 'expression' && right.kind === 'expression') {
		if (left.children.length !== right.children.length) {
			return undefined;
		}
		let current: Bindings | undefined = bindings;
		for (let i = 0; i < left.children.length; i++) {
			current = unifyAtoms(left.children[i], right.children[i], current);
			if (!current) {
				return undefined;
			}
		}
		return current;
	}
	return undefined;
}

/** Rename every variable in an atom with a unique suffix (rule freshening). */
function renameVariables(atom: MeTTaAtom, suffix: string): MeTTaAtom {
	switch (atom.kind) {
		case 'variable':
			return { kind: 'variable', name: atom.name + '#' + suffix };
		case 'expression':
			return { kind: 'expression', children: atom.children.map(c => renameVariables(c, suffix)) };
		default:
			return atom;
	}
}

// ---------------------------------------------------------------------------
// PLN deduction as a MeTTa script (native URE rule execution)
// ---------------------------------------------------------------------------

/**
 * The PLN deduction formula expressed as MeTTa rewrite rules:
 *  sAC = sAB*sBC + (1-sAB)*(sC - sB*sBC)/(1-sB)
 *  cAC = cAB*cBC*0.9
 */
export const METTA_PLN_DEDUCTION_RULES = `
; PLN deduction strength: sAC = sAB*sBC + (1-sAB)*(sC - sB*sBC)/(1-sB)
(= (pln-deduction-strength $sab $sbc $sb $sc)
	(+ (* $sab $sbc)
		(/ (* (- 1 $sab) (- $sc (* $sb $sbc))) (- 1 $sb))))

; PLN deduction confidence: cAC = cAB * cBC * 0.9
(= (pln-deduction-confidence $cab $cbc)
	(* (* $cab $cbc) 0.9))
`;

/**
 * The deduction driver: nested matches enumerate premise pairs
 * (A→B, B→C) with node priors, and produce `pln-concl` conclusion
 * expressions carrying the computed truth value and premise link ids.
 */
export const METTA_PLN_DEDUCTION_QUERY = `
!(match &self (link $l1 $a $b $sab $cab)
	(match &self (link $l2 $b $c $sbc $cbc)
		(match &self (prior $b $pb)
			(match &self (prior $c $pc)
				(pln-concl $a $c
					(pln-deduction-strength $sab $sbc $pb $pc)
					(pln-deduction-confidence $cab $cbc)
					$l1 $l2)))))
`;

function clamp01(value: number): number {
	if (!isFinite(value)) {
		return 0;
	}
	return Math.max(0, Math.min(1, value));
}

function clampPrior(value: number): number {
	return Math.max(0.01, Math.min(0.99, value));
}

// ---------------------------------------------------------------------------
// Service implementation
// ---------------------------------------------------------------------------

/**
 * Hyperon MeTTa integration service (Phase B.2). Embeds a faithful MeTTa
 * subset interpreter (S-expressions, `(= pattern result)` nondeterministic
 * rewrite rules, `match`/`if`/`quote` special forms, grounded arithmetic,
 * comparison and logic operations) over a persistent atom space, with
 * bidirectional TypeScript ↔ MeTTa binding, hypergraph import, and
 * MeTTa-native PLN deduction integrated with the PLN reasoning service.
 */
export class HyperonService extends Disposable implements IHyperonService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidRunProgram = this._register(new Emitter<MeTTaRunResult>());
	readonly onDidRunProgram: Event<MeTTaRunResult> = this._onDidRunProgram.event;

	/** The persistent atom space (facts and rules). */
	private _space: MeTTaAtom[] = [];
	private _freshCounter = 0;
	private _conclusionCounter = 0;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService,
		@IPLNReasoningService private readonly plnReasoningService: IPLNReasoningService
	) {
		super();
		this.logService.info('[HyperonService] Initialized - MeTTa interpreter ready');
	}

	// -- Program surface -------------------------------------------------------

	parse(source: string): MeTTaAtom[] {
		return parseMeTTaProgram(source).map(e => e.atom);
	}

	run(source: string): MeTTaRunResult {
		this.membraneService.recordActivity('cerebral');
		const started = Date.now();
		const context: EvalContext = { steps: 0, errors: [], budgetExceeded: false, depthExceeded: false, comboTruncated: false };
		const directives: MeTTaDirectiveResult[] = [];
		let atomsAdded = 0;
		try {
			const program = parseMeTTaProgram(source);
			const transientSpace = this._space.slice();
			for (const element of program) {
				if (!element.directive) {
					transientSpace.push(element.atom);
					atomsAdded++;
				}
			}
			for (const element of program) {
				if (element.directive) {
					const results = this._evaluate(element.atom, transientSpace, context, 0);
					directives.push({
						source: renderMeTTaAtom(element.atom),
						results,
						rendered: results.map(renderMeTTaAtom)
					});
				}
			}
		} catch (error) {
			context.errors.push(error instanceof Error ? error.message : String(error));
			this.membraneService.recordError('cerebral', `MeTTa program failed: ${context.errors[context.errors.length - 1]}`);
		}
		const result: MeTTaRunResult = {
			directives,
			atomsAdded,
			steps: context.steps,
			errors: context.errors,
			durationMs: Date.now() - started
		};
		this._onDidRunProgram.fire(result);
		return result;
	}

	addToSpace(source: string): number {
		this.membraneService.recordActivity('cerebral');
		const program = parseMeTTaProgram(source);
		let added = 0;
		for (const element of program) {
			if (element.directive) {
				throw new Error('MeTTa `!`-directives cannot be added to the space - use run()');
			}
			this._space.push(element.atom);
			added++;
		}
		return added;
	}

	query(patternSource: string, templateSource: string): MeTTaAtom[] {
		this.membraneService.recordActivity('cerebral');
		const patterns = this.parse(patternSource);
		const templates = this.parse(templateSource);
		if (patterns.length !== 1 || templates.length !== 1) {
			throw new Error('query() expects exactly one pattern atom and one template atom');
		}
		const context: EvalContext = { steps: 0, errors: [], budgetExceeded: false, depthExceeded: false, comboTruncated: false };
		const results: MeTTaAtom[] = [];
		for (const fact of this._space) {
			const bindings = unifyAtoms(patterns[0], fact, new Map());
			if (bindings) {
				const instantiated = substituteBindings(templates[0], bindings);
				results.push(...this._evaluate(instantiated, this._space, context, 0));
			}
		}
		return results;
	}

	resetSpace(): void {
		this.membraneService.recordActivity('autonomic');
		this._space = [];
		this.logService.info('[HyperonService] Space reset');
	}

	getSpaceStats(): HyperonSpaceStats {
		let ruleCount = 0;
		for (const atom of this._space) {
			if (atom.kind === 'expression' && atom.children.length === 3 &&
				atom.children[0].kind === 'symbol' && atom.children[0].name === '=') {
				ruleCount++;
			}
		}
		return { atomCount: this._space.length, ruleCount };
	}

	renderAtom(atom: MeTTaAtom): string {
		return renderMeTTaAtom(atom);
	}

	// -- Bidirectional TypeScript ↔ MeTTa binding ------------------------------

	jsToAtom(value: unknown): MeTTaAtom {
		if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
			return { kind: 'grounded', value };
		}
		if (Array.isArray(value)) {
			return { kind: 'expression', children: value.map(v => this.jsToAtom(v)) };
		}
		if (value === null || value === undefined) {
			return { kind: 'symbol', name: 'None' };
		}
		if (typeof value === 'object') {
			const children: MeTTaAtom[] = [];
			for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
				children.push({
					kind: 'expression',
					children: [{ kind: 'symbol', name: key }, this.jsToAtom(entry)]
				});
			}
			return { kind: 'expression', children };
		}
		return { kind: 'grounded', value: String(value) };
	}

	atomToJs(atom: MeTTaAtom): unknown {
		switch (atom.kind) {
			case 'grounded':
				return atom.value;
			case 'symbol':
				return atom.name;
			case 'variable':
				return '$' + atom.name;
			case 'expression':
				return atom.children.map(c => this.atomToJs(c));
		}
	}

	// -- Hypergraph integration -------------------------------------------------

	importHypergraph(): number {
		this.membraneService.recordActivity('cerebral');
		let added = 0;
		const nodes = this.hypergraphStore.getAllNodes();
		for (const node of nodes) {
			this._space.push({
				kind: 'expression',
				children: [
					{ kind: 'symbol', name: 'node' },
					{ kind: 'symbol', name: node.node_type },
					{ kind: 'symbol', name: node.id },
					{ kind: 'grounded', value: node.content }
				]
			});
			this._space.push({
				kind: 'expression',
				children: [
					{ kind: 'symbol', name: 'prior' },
					{ kind: 'symbol', name: node.id },
					{ kind: 'grounded', value: clampPrior(node.salience_score) }
				]
			});
			added += 2;
		}
		added += this._importBinaryLinks(this._space);
		this.logService.info(`[HyperonService] Imported hypergraph: ${added} atoms`);
		return added;
	}

	private _importBinaryLinks(target: MeTTaAtom[]): number {
		let added = 0;
		const seen = new Set<string>();
		for (const node of this.hypergraphStore.getAllNodes()) {
			for (const link of this.hypergraphStore.getLinksForNode(node.id)) {
				if (seen.has(link.id) || link.outgoing.length !== 2) {
					continue;
				}
				seen.add(link.id);
				const tv = this.plnReasoningService.getTruthValue(link.id) ?? { strength: 0.9, confidence: 0.5 };
				target.push({
					kind: 'expression',
					children: [
						{ kind: 'symbol', name: 'link' },
						{ kind: 'symbol', name: link.id },
						{ kind: 'symbol', name: link.outgoing[0] },
						{ kind: 'symbol', name: link.outgoing[1] },
						{ kind: 'grounded', value: tv.strength },
						{ kind: 'grounded', value: tv.confidence }
					]
				});
				added++;
			}
		}
		return added;
	}

	// -- MeTTa-native PLN deduction (URE integration) ---------------------------

	runPLNDeduction(options?: MettaPLNOptions): MettaPLNResult {
		this.membraneService.recordActivity('cerebral');
		const started = Date.now();
		const minConfidence = options?.minConfidence ?? 0.05;
		const maxConclusions = options?.maxConclusions ?? 200;

		// Build a dedicated reasoning space from the live hypergraph so each
		// run reflects current knowledge without polluting the persistent space.
		const reasoningSpace: MeTTaAtom[] = [];
		for (const node of this.hypergraphStore.getAllNodes()) {
			reasoningSpace.push({
				kind: 'expression',
				children: [
					{ kind: 'symbol', name: 'prior' },
					{ kind: 'symbol', name: node.id },
					{ kind: 'grounded', value: clampPrior(node.salience_score) }
				]
			});
		}
		this._importBinaryLinks(reasoningSpace);
		for (const element of parseMeTTaProgram(METTA_PLN_DEDUCTION_RULES)) {
			reasoningSpace.push(element.atom);
		}

		const context: EvalContext = { steps: 0, errors: [], budgetExceeded: false, depthExceeded: false, comboTruncated: false };
		const program = parseMeTTaProgram(METTA_PLN_DEDUCTION_QUERY);
		const conclusions: MeTTaAtom[] = [];
		for (const element of program) {
			conclusions.push(...this._evaluate(element.atom, reasoningSpace, context, 0));
		}

		// Collect existing MeTTa-deduction conclusions so re-runs stay idempotent.
		const existingPairs = new Set<string>();
		for (const link of this.hypergraphStore.getLinksByType('Inferred')) {
			if (link.metadata?.rule === 'metta-deduction' && link.outgoing.length === 2) {
				existingPairs.add(`${link.outgoing[0]}|${link.outgoing[1]}`);
			}
		}

		// Parse conclusion expressions and keep the strongest per (from, to) pair.
		const best = new Map<string, { from: string; to: string; tv: TruthValue; premises: string[] }>();
		for (const conclusion of conclusions) {
			if (conclusion.kind !== 'expression' || conclusion.children.length !== 7) {
				continue;
			}
			const [head, fromAtom, toAtom, strengthAtom, confidenceAtom, ...premiseAtoms] = conclusion.children;
			if (head.kind !== 'symbol' || head.name !== 'pln-concl') {
				continue;
			}
			if (fromAtom.kind !== 'symbol' || toAtom.kind !== 'symbol') {
				continue;
			}
			if (strengthAtom.kind !== 'grounded' || typeof strengthAtom.value !== 'number' ||
				confidenceAtom.kind !== 'grounded' || typeof confidenceAtom.value !== 'number') {
				continue;
			}
			const from = fromAtom.name;
			const to = toAtom.name;
			if (from === to) {
				continue;
			}
			const key = `${from}|${to}`;
			if (existingPairs.has(key)) {
				continue;
			}
			const tv: TruthValue = {
				strength: clamp01(strengthAtom.value),
				confidence: clamp01(confidenceAtom.value)
			};
			if (tv.confidence < minConfidence) {
				continue;
			}
			const premises: string[] = [];
			for (const premiseAtom of premiseAtoms) {
				if (premiseAtom.kind === 'symbol') {
					premises.push(premiseAtom.name);
				}
			}
			const current = best.get(key);
			if (!current || tv.confidence > current.tv.confidence) {
				best.set(key, { from, to, tv, premises });
			}
		}

		// Persist surviving conclusions as Inferred hypergraph links and feed
		// their truth values into the PLN reasoning service (native URE handoff).
		const inferred: MettaInferredConclusion[] = [];
		for (const entry of best.values()) {
			if (inferred.length >= maxConclusions) {
				break;
			}
			const linkId = `metta-deduction-${Date.now()}-${++this._conclusionCounter}`;
			const link: HypergraphLink = {
				id: linkId,
				link_type: 'Inferred',
				outgoing: [entry.from, entry.to],
				metadata: {
					inferred: true,
					rule: 'metta-deduction',
					truthValue: entry.tv,
					premises: entry.premises
				}
			};
			this.hypergraphStore.addLink(link);
			this.plnReasoningService.setTruthValue(linkId, entry.tv);
			inferred.push({
				linkId,
				from: entry.from,
				to: entry.to,
				truthValue: entry.tv,
				premises: entry.premises
			});
		}

		const result: MettaPLNResult = {
			inferred,
			conclusionsExamined: conclusions.length,
			steps: context.steps,
			durationMs: Date.now() - started,
			errors: context.errors
		};
		this.logService.info(`[HyperonService] MeTTa PLN deduction: ${inferred.length} conclusions persisted (${conclusions.length} examined, ${context.steps} steps)`);
		return result;
	}

	// -- Evaluator ---------------------------------------------------------------

	private _evaluate(atom: MeTTaAtom, space: MeTTaAtom[], context: EvalContext, depth: number): MeTTaAtom[] {
		context.steps++;
		if (context.steps > DEFAULT_STEP_BUDGET) {
			if (!context.budgetExceeded) {
				context.budgetExceeded = true;
				context.errors.push(`MeTTa evaluation budget of ${DEFAULT_STEP_BUDGET} steps exceeded`);
			}
			return [atom];
		}
		if (depth > MAX_EVAL_DEPTH) {
			if (!context.depthExceeded) {
				context.depthExceeded = true;
				context.errors.push(`MeTTa evaluation depth limit of ${MAX_EVAL_DEPTH} exceeded`);
			}
			return [atom];
		}
		if (atom.kind !== 'expression' || atom.children.length === 0) {
			return [atom];
		}

		const head = atom.children[0];
		if (head.kind === 'symbol') {
			if (head.name === 'quote' && atom.children.length === 2) {
				return [atom.children[1]];
			}
			if (head.name === 'if' && atom.children.length === 4) {
				return this._evaluateIf(atom, space, context, depth);
			}
			if (head.name === 'match' && atom.children.length === 4) {
				return this._evaluateMatch(atom, space, context, depth);
			}
		}

		// Applicative order: evaluate children, then apply over each combination.
		const childResults = atom.children.map(child => this._evaluate(child, space, context, depth + 1));
		const combinations = this._cartesian(childResults, context);
		const output: MeTTaAtom[] = [];
		for (const combination of combinations) {
			const expression: MeTTaAtom = { kind: 'expression', children: combination };
			const builtinResult = this._applyBuiltin(expression, context);
			if (builtinResult !== undefined) {
				output.push(...builtinResult);
				continue;
			}
			const ruleResults = this._applyRules(expression, space, context, depth);
			if (ruleResults !== undefined) {
				output.push(...ruleResults);
				continue;
			}
			output.push(expression);
		}
		return output;
	}

	private _evaluateIf(atom: { kind: 'expression'; children: MeTTaAtom[] }, space: MeTTaAtom[], context: EvalContext, depth: number): MeTTaAtom[] {
		const results: MeTTaAtom[] = [];
		for (const condition of this._evaluate(atom.children[1], space, context, depth + 1)) {
			if (condition.kind === 'grounded' && typeof condition.value === 'boolean') {
				const branch = condition.value ? atom.children[2] : atom.children[3];
				results.push(...this._evaluate(branch, space, context, depth + 1));
			} else {
				context.errors.push(`MeTTa if: condition did not evaluate to a boolean: ${renderMeTTaAtom(condition)}`);
			}
		}
		return results;
	}

	private _evaluateMatch(atom: { kind: 'expression'; children: MeTTaAtom[] }, space: MeTTaAtom[], context: EvalContext, depth: number): MeTTaAtom[] {
		const spaceRef = atom.children[1];
		if (spaceRef.kind !== 'symbol' || spaceRef.name !== '&self') {
			context.errors.push(`MeTTa match: unsupported space reference ${renderMeTTaAtom(spaceRef)} (only &self is supported)`);
			return [atom];
		}
		const pattern = atom.children[2];
		const template = atom.children[3];
		const results: MeTTaAtom[] = [];
		for (const fact of space) {
			const bindings = unifyAtoms(pattern, fact, new Map());
			if (bindings) {
				const instantiated = substituteBindings(template, bindings);
				results.push(...this._evaluate(instantiated, space, context, depth + 1));
			}
		}
		return results;
	}

	/**
	 * Apply grounded builtin operations. Returns undefined when the expression
	 * is not an applicable builtin call (falls through to rules).
	 */
	private _applyBuiltin(expression: { kind: 'expression'; children: MeTTaAtom[] }, context: EvalContext): MeTTaAtom[] | undefined {
		const head = expression.children[0];
		if (head.kind !== 'symbol') {
			return undefined;
		}
		const args = expression.children.slice(1);
		const name = head.name;

		if (name === '==' && args.length === 2) {
			return [{ kind: 'grounded', value: atomsEqual(args[0], args[1]) }];
		}

		if ((name === 'and' || name === 'or') && args.length === 2 &&
			args.every(a => a.kind === 'grounded' && typeof a.value === 'boolean')) {
			const left = (args[0] as { kind: 'grounded'; value: boolean }).value;
			const right = (args[1] as { kind: 'grounded'; value: boolean }).value;
			return [{ kind: 'grounded', value: name === 'and' ? (left && right) : (left || right) }];
		}
		if (name === 'not' && args.length === 1 && args[0].kind === 'grounded' && typeof args[0].value === 'boolean') {
			return [{ kind: 'grounded', value: !args[0].value }];
		}

		const numeric = args.every(a => a.kind === 'grounded' && typeof a.value === 'number');
		if (!numeric) {
			return undefined;
		}
		const values = args.map(a => (a as { kind: 'grounded'; value: number }).value);

		if (args.length === 2) {
			switch (name) {
				case '+':
					return [{ kind: 'grounded', value: values[0] + values[1] }];
				case '-':
					return [{ kind: 'grounded', value: values[0] - values[1] }];
				case '*':
					return [{ kind: 'grounded', value: values[0] * values[1] }];
				case '/':
					if (values[1] === 0) {
						context.errors.push('MeTTa arithmetic error: division by zero');
						return [];
					}
					return [{ kind: 'grounded', value: values[0] / values[1] }];
				case '<':
					return [{ kind: 'grounded', value: values[0] < values[1] }];
				case '>':
					return [{ kind: 'grounded', value: values[0] > values[1] }];
				case '<=':
					return [{ kind: 'grounded', value: values[0] <= values[1] }];
				case '>=':
					return [{ kind: 'grounded', value: values[0] >= values[1] }];
				case 'min':
					return [{ kind: 'grounded', value: Math.min(values[0], values[1]) }];
				case 'max':
					return [{ kind: 'grounded', value: Math.max(values[0], values[1]) }];
				case 'pow':
					return [{ kind: 'grounded', value: Math.pow(values[0], values[1]) }];
			}
		}
		if (args.length === 1) {
			switch (name) {
				case 'abs':
					return [{ kind: 'grounded', value: Math.abs(values[0]) }];
				case 'sqrt':
					if (values[0] < 0) {
						context.errors.push('MeTTa arithmetic error: sqrt of negative number');
						return [];
					}
					return [{ kind: 'grounded', value: Math.sqrt(values[0]) }];
			}
		}
		return undefined;
	}

	/**
	 * Apply `(= pattern result)` rewrite rules from the space. Returns undefined
	 * when no rule matches (the expression is already in normal form).
	 */
	private _applyRules(expression: MeTTaAtom, space: MeTTaAtom[], context: EvalContext, depth: number): MeTTaAtom[] | undefined {
		let matched = false;
		const results: MeTTaAtom[] = [];
		for (const candidate of space) {
			if (candidate.kind !== 'expression' || candidate.children.length !== 3) {
				continue;
			}
			const ruleHead = candidate.children[0];
			if (ruleHead.kind !== 'symbol' || ruleHead.name !== '=') {
				continue;
			}
			const fresh = renameVariables(candidate, String(++this._freshCounter)) as { kind: 'expression'; children: MeTTaAtom[] };
			const bindings = unifyAtoms(fresh.children[1], expression, new Map());
			if (bindings) {
				matched = true;
				const body = substituteBindings(fresh.children[2], bindings);
				results.push(...this._evaluate(body, space, context, depth + 1));
			}
		}
		return matched ? results : undefined;
	}

	/** Bounded cartesian product of evaluated child results. */
	private _cartesian(childResults: MeTTaAtom[][], context: EvalContext): MeTTaAtom[][] {
		let combinations: MeTTaAtom[][] = [[]];
		for (const results of childResults) {
			if (results.length === 0) {
				return [];
			}
			const next: MeTTaAtom[][] = [];
			for (const combination of combinations) {
				for (const result of results) {
					next.push([...combination, result]);
					if (next.length > MAX_COMBINATIONS) {
						if (!context.comboTruncated) {
							context.comboTruncated = true;
							context.errors.push(`MeTTa combination limit of ${MAX_COMBINATIONS} exceeded - results truncated`);
						}
						return next;
					}
				}
			}
			combinations = next;
		}
		return combinations;
	}
}
