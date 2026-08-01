"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.CancelableAsyncIterableObject = exports.AsyncIterableObject = exports.Promises = exports.DeferredPromise = exports.IntervalCounter = exports.TaskSequentializer = exports.IdleValue = exports.runWhenIdle = exports.ThrottledWorker = exports.RunOnceWorker = exports.ProcessTimeRunOnceScheduler = exports.RunOnceScheduler = exports.IntervalTimer = exports.TimeoutTimer = exports.ResourceQueue = exports.LimitedQueue = exports.Queue = exports.Limiter = exports.AutoOpenBarrier = exports.Barrier = exports.ThrottledDelayer = exports.Delayer = exports.SequencerByKey = exports.Sequencer = exports.Throttler = void 0;
exports.isThenable = isThenable;
exports.createCancelablePromise = createCancelablePromise;
exports.raceCancellation = raceCancellation;
exports.raceCancellationError = raceCancellationError;
exports.raceCancellablePromises = raceCancellablePromises;
exports.raceTimeout = raceTimeout;
exports.asPromise = asPromise;
exports.timeout = timeout;
exports.disposableTimeout = disposableTimeout;
exports.sequence = sequence;
exports.first = first;
exports.firstParallel = firstParallel;
exports.retry = retry;
exports.createCancelableAsyncIterable = createCancelableAsyncIterable;
const cancellation_1 = require("vs/base/common/cancellation");
const errors_1 = require("vs/base/common/errors");
const event_1 = require("vs/base/common/event");
const lifecycle_1 = require("vs/base/common/lifecycle");
const resources_1 = require("vs/base/common/resources");
const platform_1 = require("vs/base/common/platform");
const symbols_1 = require("./symbols");
function isThenable(obj) {
	return !!obj && typeof obj.then === 'function';
}
function createCancelablePromise(callback) {
	const source = new cancellation_1.CancellationTokenSource();
	const thenable = callback(source.token);
	const promise = new Promise((resolve, reject) => {
		const subscription = source.token.onCancellationRequested(() => {
			subscription.dispose();
			source.dispose();
			reject(new errors_1.CancellationError());
		});
		Promise.resolve(thenable).then(value => {
			subscription.dispose();
			source.dispose();
			resolve(value);
		}, err => {
			subscription.dispose();
			source.dispose();
			reject(err);
		});
	});
	return new class {
		cancel() {
			source.cancel();
		}
		then(resolve, reject) {
			return promise.then(resolve, reject);
		}
		catch(reject) {
			return this.then(undefined, reject);
		}
		finally(onfinally) {
			return promise.finally(onfinally);
		}
	};
}
function raceCancellation(promise, token, defaultValue) {
	return new Promise((resolve, reject) => {
		const ref = token.onCancellationRequested(() => {
			ref.dispose();
			resolve(defaultValue);
		});
		promise.then(resolve, reject).finally(() => ref.dispose());
	});
}
/**
 * Returns a promise that rejects with an {@CancellationError} as soon as the passed token is cancelled.
 * @see {@link raceCancellation}
 */
function raceCancellationError(promise, token) {
	return new Promise((resolve, reject) => {
		const ref = token.onCancellationRequested(() => {
			ref.dispose();
			reject(new errors_1.CancellationError());
		});
		promise.then(resolve, reject).finally(() => ref.dispose());
	});
}
/**
 * Returns as soon as one of the promises resolves or rejects and cancels remaining promises
 */
async function raceCancellablePromises(cancellablePromises) {
	let resolvedPromiseIndex = -1;
	const promises = cancellablePromises.map((promise, index) => promise.then(result => { resolvedPromiseIndex = index; return result; }));
	try {
		const result = await Promise.race(promises);
		return result;
	}
	finally {
		cancellablePromises.forEach((cancellablePromise, index) => {
			if (index !== resolvedPromiseIndex) {
				cancellablePromise.cancel();
			}
		});
	}
}
function raceTimeout(promise, timeout, onTimeout) {
	let promiseResolve = undefined;
	const timer = setTimeout(() => {
		promiseResolve?.(undefined);
		onTimeout?.();
	}, timeout);
	return Promise.race([
		promise.finally(() => clearTimeout(timer)),
		new Promise(resolve => promiseResolve = resolve)
	]);
}
function asPromise(callback) {
	return new Promise((resolve, reject) => {
		const item = callback();
		if (isThenable(item)) {
			item.then(resolve, reject);
		}
		else {
			resolve(item);
		}
	});
}
/**
 * A helper to prevent accumulation of sequential async tasks.
 *
 * Imagine a mail man with the sole task of delivering letters. As soon as
 * a letter submitted for delivery, he drives to the destination, delivers it
 * and returns to his base. Imagine that during the trip, N more letters were submitted.
 * When the mail man returns, he picks those N letters and delivers them all in a
 * single trip. Even though N+1 submissions occurred, only 2 deliveries were made.
 *
 * The throttler implements this via the queue() method, by providing it a task
 * factory. Following the example:
 *
 * 		const throttler = new Throttler();
 * 		const letters = [];
 *
 * 		function deliver() {
 * 			const lettersToDeliver = letters;
 * 			letters = [];
 * 			return makeTheTrip(lettersToDeliver);
 * 		}
 *
 * 		function onLetterReceived(l) {
 * 			letters.push(l);
 * 			throttler.queue(deliver);
 * 		}
 */
class Throttler {
	activePromise;
	queuedPromise;
	queuedPromiseFactory;
	isDisposed = false;
	constructor() {
		this.activePromise = null;
		this.queuedPromise = null;
		this.queuedPromiseFactory = null;
	}
	queue(promiseFactory) {
		if (this.isDisposed) {
			throw new Error('Throttler is disposed');
		}
		if (this.activePromise) {
			this.queuedPromiseFactory = promiseFactory;
			if (!this.queuedPromise) {
				const onComplete = () => {
					this.queuedPromise = null;
					if (this.isDisposed) {
						return undefined; // {{SQL CARBON EDIT}}
					}
					const result = this.queue(this.queuedPromiseFactory);
					this.queuedPromiseFactory = null;
					return result;
				};
				this.queuedPromise = new Promise(resolve => {
					this.activePromise.then(onComplete, onComplete).then(resolve);
				});
			}
			return new Promise((resolve, reject) => {
				this.queuedPromise.then(resolve, reject);
			});
		}
		this.activePromise = promiseFactory();
		return new Promise((resolve, reject) => {
			this.activePromise.then((result) => {
				this.activePromise = null;
				resolve(result);
			}, (err) => {
				this.activePromise = null;
				reject(err);
			});
		});
	}
	dispose() {
		this.isDisposed = true;
	}
}
exports.Throttler = Throttler;
class Sequencer {
	current = Promise.resolve(null);
	queue(promiseTask) {
		return this.current = this.current.then(() => promiseTask(), () => promiseTask());
	}
}
exports.Sequencer = Sequencer;
class SequencerByKey {
	promiseMap = new Map();
	queue(key, promiseTask) {
		const runningPromise = this.promiseMap.get(key) ?? Promise.resolve();
		const newPromise = runningPromise
			.catch(() => { })
			.then(promiseTask)
			.finally(() => {
			if (this.promiseMap.get(key) === newPromise) {
				this.promiseMap.delete(key);
			}
		});
		this.promiseMap.set(key, newPromise);
		return newPromise;
	}
}
exports.SequencerByKey = SequencerByKey;
const timeoutDeferred = (timeout, fn) => {
	let scheduled = true;
	const handle = setTimeout(() => {
		scheduled = false;
		fn();
	}, timeout);
	return {
		isTriggered: () => scheduled,
		dispose: () => {
			clearTimeout(handle);
			scheduled = false;
		},
	};
};
const microtaskDeferred = (fn) => {
	let scheduled = true;
	queueMicrotask(() => {
		if (scheduled) {
			scheduled = false;
			fn();
		}
	});
	return {
		isTriggered: () => scheduled,
		dispose: () => { scheduled = false; },
	};
};
/**
 * A helper to delay (debounce) execution of a task that is being requested often.
 *
 * Following the throttler, now imagine the mail man wants to optimize the number of
 * trips proactively. The trip itself can be long, so he decides not to make the trip
 * as soon as a letter is submitted. Instead he waits a while, in case more
 * letters are submitted. After said waiting period, if no letters were submitted, he
 * decides to make the trip. Imagine that N more letters were submitted after the first
 * one, all within a short period of time between each other. Even though N+1
 * submissions occurred, only 1 delivery was made.
 *
 * The delayer offers this behavior via the trigger() method, into which both the task
 * to be executed and the waiting period (delay) must be passed in as arguments. Following
 * the example:
 *
 * 		const delayer = new Delayer(WAITING_PERIOD);
 * 		const letters = [];
 *
 * 		function letterReceived(l) {
 * 			letters.push(l);
 * 			delayer.trigger(() => { return makeTheTrip(); });
 * 		}
 */
class Delayer {
	defaultDelay;
	deferred;
	completionPromise;
	doResolve;
	doReject;
	task;
	constructor(defaultDelay) {
		this.defaultDelay = defaultDelay;
		this.deferred = null;
		this.completionPromise = null;
		this.doResolve = null;
		this.doReject = null;
		this.task = null;
	}
	trigger(task, delay = this.defaultDelay) {
		this.task = task;
		this.cancelTimeout();
		if (!this.completionPromise) {
			this.completionPromise = new Promise((resolve, reject) => {
				this.doResolve = resolve;
				this.doReject = reject;
			}).then(() => {
				this.completionPromise = null;
				this.doResolve = null;
				if (this.task) {
					const task = this.task;
					this.task = null;
					return task();
				}
				return undefined;
			});
		}
		const fn = () => {
			this.deferred = null;
			this.doResolve?.(null);
		};
		this.deferred = delay === symbols_1.MicrotaskDelay ? microtaskDeferred(fn) : timeoutDeferred(delay, fn);
		return this.completionPromise;
	}
	isTriggered() {
		return !!this.deferred?.isTriggered();
	}
	cancel() {
		this.cancelTimeout();
		if (this.completionPromise) {
			this.doReject?.(new errors_1.CancellationError());
			this.completionPromise = null;
		}
	}
	cancelTimeout() {
		this.deferred?.dispose();
		this.deferred = null;
	}
	dispose() {
		this.cancel();
	}
}
exports.Delayer = Delayer;
/**
 * A helper to delay execution of a task that is being requested often, while
 * preventing accumulation of consecutive executions, while the task runs.
 *
 * The mail man is clever and waits for a certain amount of time, before going
 * out to deliver letters. While the mail man is going out, more letters arrive
 * and can only be delivered once he is back. Once he is back the mail man will
 * do one more trip to deliver the letters that have accumulated while he was out.
 */
class ThrottledDelayer {
	delayer;
	throttler;
	constructor(defaultDelay) {
		this.delayer = new Delayer(defaultDelay);
		this.throttler = new Throttler();
	}
	trigger(promiseFactory, delay) {
		return this.delayer.trigger(() => this.throttler.queue(promiseFactory), delay);
	}
	isTriggered() {
		return this.delayer.isTriggered();
	}
	cancel() {
		this.delayer.cancel();
	}
	dispose() {
		this.delayer.dispose();
		this.throttler.dispose();
	}
}
exports.ThrottledDelayer = ThrottledDelayer;
/**
 * A barrier that is initially closed and then becomes opened permanently.
 */
class Barrier {
	_isOpen;
	_promise;
	_completePromise;
	constructor() {
		this._isOpen = false;
		this._promise = new Promise((c, e) => {
			this._completePromise = c;
		});
	}
	isOpen() {
		return this._isOpen;
	}
	open() {
		this._isOpen = true;
		this._completePromise(true);
	}
	wait() {
		return this._promise;
	}
}
exports.Barrier = Barrier;
/**
 * A barrier that is initially closed and then becomes opened permanently after a certain period of
 * time or when open is called explicitly
 */
class AutoOpenBarrier extends Barrier {
	_timeout;
	constructor(autoOpenTimeMs) {
		super();
		this._timeout = setTimeout(() => this.open(), autoOpenTimeMs);
	}
	open() {
		clearTimeout(this._timeout);
		super.open();
	}
}
exports.AutoOpenBarrier = AutoOpenBarrier;
function timeout(millis, token) {
	if (!token) {
		return createCancelablePromise(token => timeout(millis, token));
	}
	return new Promise((resolve, reject) => {
		const handle = setTimeout(() => {
			disposable.dispose();
			resolve();
		}, millis);
		const disposable = token.onCancellationRequested(() => {
			clearTimeout(handle);
			disposable.dispose();
			reject(new errors_1.CancellationError());
		});
	});
}
function disposableTimeout(handler, timeout = 0) {
	const timer = setTimeout(handler, timeout);
	return (0, lifecycle_1.toDisposable)(() => clearTimeout(timer));
}
/**
 * Runs the provided list of promise factories in sequential order. The returned
 * promise will complete to an array of results from each promise.
 */
function sequence(promiseFactories) {
	const results = [];
	let index = 0;
	const len = promiseFactories.length;
	function next() {
		return index < len ? promiseFactories[index++]() : null;
	}
	function thenHandler(result) {
		if (result !== undefined && result !== null) {
			results.push(result);
		}
		const n = next();
		if (n) {
			return n.then(thenHandler);
		}
		return Promise.resolve(results);
	}
	return Promise.resolve(null).then(thenHandler);
}
function first(promiseFactories, shouldStop = t => !!t, defaultValue = null) {
	let index = 0;
	const len = promiseFactories.length;
	const loop = () => {
		if (index >= len) {
			return Promise.resolve(defaultValue);
		}
		const factory = promiseFactories[index++];
		const promise = Promise.resolve(factory());
		return promise.then(result => {
			if (shouldStop(result)) {
				return Promise.resolve(result);
			}
			return loop();
		});
	};
	return loop();
}
function firstParallel(promiseList, shouldStop = t => !!t, defaultValue = null) {
	if (promiseList.length === 0) {
		return Promise.resolve(defaultValue);
	}
	let todo = promiseList.length;
	const finish = () => {
		todo = -1;
		for (const promise of promiseList) {
			promise.cancel?.();
		}
	};
	return new Promise((resolve, reject) => {
		for (const promise of promiseList) {
			promise.then(result => {
				if (--todo >= 0 && shouldStop(result)) {
					finish();
					resolve(result);
				}
				else if (todo === 0) {
					resolve(defaultValue);
				}
			})
				.catch(err => {
				if (--todo >= 0) {
					finish();
					reject(err);
				}
			});
		}
	});
}
/**
 * A helper to queue N promises and run them all with a max degree of parallelism. The helper
 * ensures that at any time no more than M promises are running at the same time.
 */
class Limiter {
	_size = 0;
	runningPromises;
	maxDegreeOfParalellism;
	outstandingPromises;
	_onDrained;
	constructor(maxDegreeOfParalellism) {
		this.maxDegreeOfParalellism = maxDegreeOfParalellism;
		this.outstandingPromises = [];
		this.runningPromises = 0;
		this._onDrained = new event_1.Emitter();
	}
	/**
	 * An event that fires when every promise in the queue
	 * has started to execute. In other words: no work is
	 * pending to be scheduled.
	 *
	 * This is NOT an event that signals when all promises
	 * have finished though.
	 */
	get onDrained() {
		return this._onDrained.event;
	}
	get size() {
		return this._size;
	}
	queue(factory) {
		this._size++;
		return new Promise((c, e) => {
			this.outstandingPromises.push({ factory, c, e });
			this.consume();
		});
	}
	consume() {
		while (this.outstandingPromises.length && this.runningPromises < this.maxDegreeOfParalellism) {
			const iLimitedTask = this.outstandingPromises.shift();
			this.runningPromises++;
			const promise = iLimitedTask.factory();
			promise.then(iLimitedTask.c, iLimitedTask.e);
			promise.then(() => this.consumed(), () => this.consumed());
		}
	}
	consumed() {
		this._size--;
		this.runningPromises--;
		if (this.outstandingPromises.length > 0) {
			this.consume();
		}
		else {
			this._onDrained.fire();
		}
	}
	dispose() {
		this._onDrained.dispose();
	}
}
exports.Limiter = Limiter;
/**
 * A queue is handles one promise at a time and guarantees that at any time only one promise is executing.
 */
class Queue extends Limiter {
	constructor() {
		super(1);
	}
}
exports.Queue = Queue;
/**
 * Same as `Queue`, ensures that only 1 task is executed at the same time. The difference to `Queue` is that
 * there is only 1 task about to be scheduled next. As such, calling `queue` while a task is executing will
 * replace the currently queued task until it executes.
 *
 * As such, the returned promise may not be from the factory that is passed in but from the next factory that
 * is running after having called `queue`.
 */
class LimitedQueue {
	sequentializer = new TaskSequentializer();
	tasks = 0;
	queue(factory) {
		if (!this.sequentializer.isRunning()) {
			return this.sequentializer.run(this.tasks++, factory());
		}
		return this.sequentializer.queue(() => {
			return this.sequentializer.run(this.tasks++, factory());
		});
	}
}
exports.LimitedQueue = LimitedQueue;
/**
 * A helper to organize queues per resource. The ResourceQueue makes sure to manage queues per resource
 * by disposing them once the queue is empty.
 */
class ResourceQueue {
	queues = new Map();
	drainers = new Set();
	async whenDrained() {
		if (this.isDrained()) {
			return;
		}
		const promise = new DeferredPromise();
		this.drainers.add(promise);
		return promise.p;
	}
	isDrained() {
		for (const [, queue] of this.queues) {
			if (queue.size > 0) {
				return false;
			}
		}
		return true;
	}
	queueFor(resource, extUri = resources_1.extUri) {
		const key = extUri.getComparisonKey(resource);
		let queue = this.queues.get(key);
		if (!queue) {
			queue = new Queue();
			event_1.Event.once(queue.onDrained)(() => {
				queue?.dispose();
				this.queues.delete(key);
				this.onDidQueueDrain();
			});
			this.queues.set(key, queue);
		}
		return queue;
	}
	onDidQueueDrain() {
		if (!this.isDrained()) {
			return; // not done yet
		}
		this.releaseDrainers();
	}
	releaseDrainers() {
		for (const drainer of this.drainers) {
			drainer.complete();
		}
		this.drainers.clear();
	}
	dispose() {
		for (const [, queue] of this.queues) {
			queue.dispose();
		}
		this.queues.clear();
		// Even though we might still have pending
		// tasks queued, after the queues have been
		// disposed, we can no longer track them, so
		// we release drainers to prevent hanging
		// promises when the resource queue is being
		// disposed.
		this.releaseDrainers();
	}
}
exports.ResourceQueue = ResourceQueue;
class TimeoutTimer {
	_token;
	constructor(runner, timeout) {
		this._token = -1;
		if (typeof runner === 'function' && typeof timeout === 'number') {
			this.setIfNotSet(runner, timeout);
		}
	}
	dispose() {
		this.cancel();
	}
	cancel() {
		if (this._token !== -1) {
			clearTimeout(this._token);
			this._token = -1;
		}
	}
	cancelAndSet(runner, timeout) {
		this.cancel();
		this._token = setTimeout(() => {
			this._token = -1;
			runner();
		}, timeout);
	}
	setIfNotSet(runner, timeout) {
		if (this._token !== -1) {
			// timer is already set
			return;
		}
		this._token = setTimeout(() => {
			this._token = -1;
			runner();
		}, timeout);
	}
}
exports.TimeoutTimer = TimeoutTimer;
class IntervalTimer {
	_token;
	constructor() {
		this._token = -1;
	}
	dispose() {
		this.cancel();
	}
	cancel() {
		if (this._token !== -1) {
			clearInterval(this._token);
			this._token = -1;
		}
	}
	cancelAndSet(runner, interval) {
		this.cancel();
		this._token = setInterval(() => {
			runner();
		}, interval);
	}
}
exports.IntervalTimer = IntervalTimer;
class RunOnceScheduler {
	runner;
	timeoutToken;
	timeout;
	timeoutHandler;
	constructor(runner, delay) {
		this.timeoutToken = -1;
		this.runner = runner;
		this.timeout = delay;
		this.timeoutHandler = this.onTimeout.bind(this);
	}
	/**
	 * Dispose RunOnceScheduler
	 */
	dispose() {
		this.cancel();
		this.runner = null;
	}
	/**
	 * Cancel current scheduled runner (if any).
	 */
	cancel() {
		if (this.isScheduled()) {
			clearTimeout(this.timeoutToken);
			this.timeoutToken = -1;
		}
	}
	/**
	 * Cancel previous runner (if any) & schedule a new runner.
	 */
	schedule(delay = this.timeout) {
		this.cancel();
		this.timeoutToken = setTimeout(this.timeoutHandler, delay);
	}
	get delay() {
		return this.timeout;
	}
	set delay(value) {
		this.timeout = value;
	}
	/**
	 * Returns true if scheduled.
	 */
	isScheduled() {
		return this.timeoutToken !== -1;
	}
	flush() {
		if (this.isScheduled()) {
			this.cancel();
			this.doRun();
		}
	}
	onTimeout() {
		this.timeoutToken = -1;
		if (this.runner) {
			this.doRun();
		}
	}
	doRun() {
		this.runner?.();
	}
}
exports.RunOnceScheduler = RunOnceScheduler;
/**
 * Same as `RunOnceScheduler`, but doesn't count the time spent in sleep mode.
 * > **NOTE**: Only offers 1s resolution.
 *
 * When calling `setTimeout` with 3hrs, and putting the computer immediately to sleep
 * for 8hrs, `setTimeout` will fire **as soon as the computer wakes from sleep**. But
 * this scheduler will execute 3hrs **after waking the computer from sleep**.
 */
class ProcessTimeRunOnceScheduler {
	runner;
	timeout;
	counter;
	intervalToken;
	intervalHandler;
	constructor(runner, delay) {
		if (delay % 1000 !== 0) {
			console.warn(`ProcessTimeRunOnceScheduler resolution is 1s, ${delay}ms is not a multiple of 1000ms.`);
		}
		this.runner = runner;
		this.timeout = delay;
		this.counter = 0;
		this.intervalToken = -1;
		this.intervalHandler = this.onInterval.bind(this);
	}
	dispose() {
		this.cancel();
		this.runner = null;
	}
	cancel() {
		if (this.isScheduled()) {
			clearInterval(this.intervalToken);
			this.intervalToken = -1;
		}
	}
	/**
	 * Cancel previous runner (if any) & schedule a new runner.
	 */
	schedule(delay = this.timeout) {
		if (delay % 1000 !== 0) {
			console.warn(`ProcessTimeRunOnceScheduler resolution is 1s, ${delay}ms is not a multiple of 1000ms.`);
		}
		this.cancel();
		this.counter = Math.ceil(delay / 1000);
		this.intervalToken = setInterval(this.intervalHandler, 1000);
	}
	/**
	 * Returns true if scheduled.
	 */
	isScheduled() {
		return this.intervalToken !== -1;
	}
	onInterval() {
		this.counter--;
		if (this.counter > 0) {
			// still need to wait
			return;
		}
		// time elapsed
		clearInterval(this.intervalToken);
		this.intervalToken = -1;
		this.runner?.();
	}
}
exports.ProcessTimeRunOnceScheduler = ProcessTimeRunOnceScheduler;
class RunOnceWorker extends RunOnceScheduler {
	units = [];
	constructor(runner, timeout) {
		super(runner, timeout);
	}
	work(unit) {
		this.units.push(unit);
		if (!this.isScheduled()) {
			this.schedule();
		}
	}
	doRun() {
		const units = this.units;
		this.units = [];
		this.runner?.(units);
	}
	dispose() {
		this.units = [];
		super.dispose();
	}
}
exports.RunOnceWorker = RunOnceWorker;
/**
 * The `ThrottledWorker` will accept units of work `T`
 * to handle. The contract is:
 * * there is a maximum of units the worker can handle at once (via `maxWorkChunkSize`)
 * * there is a maximum of units the worker will keep in memory for processing (via `maxBufferedWork`)
 * * after having handled `maxWorkChunkSize` units, the worker needs to rest (via `throttleDelay`)
 */
class ThrottledWorker extends lifecycle_1.Disposable {
	options;
	handler;
	pendingWork = [];
	throttler = this._register(new lifecycle_1.MutableDisposable());
	disposed = false;
	constructor(options, handler) {
		super();
		this.options = options;
		this.handler = handler;
	}
	/**
	 * The number of work units that are pending to be processed.
	 */
	get pending() { return this.pendingWork.length; }
	/**
	 * Add units to be worked on. Use `pending` to figure out
	 * how many units are not yet processed after this method
	 * was called.
	 *
	 * @returns whether the work was accepted or not. If the
	 * worker is disposed, it will not accept any more work.
	 * If the number of pending units would become larger
	 * than `maxPendingWork`, more work will also not be accepted.
	 */
	work(units) {
		if (this.disposed) {
			return false; // work not accepted: disposed
		}
		// Check for reaching maximum of pending work
		if (typeof this.options.maxBufferedWork === 'number') {
			// Throttled: simple check if pending + units exceeds max pending
			if (this.throttler.value) {
				if (this.pending + units.length > this.options.maxBufferedWork) {
					return false; // work not accepted: too much pending work
				}
			}
			// Unthrottled: same as throttled, but account for max chunk getting
			// worked on directly without being pending
			else {
				if (this.pending + units.length - this.options.maxWorkChunkSize > this.options.maxBufferedWork) {
					return false; // work not accepted: too much pending work
				}
			}
		}
		// Add to pending units first
		for (const unit of units) {
			this.pendingWork.push(unit);
		}
		// If not throttled, start working directly
		// Otherwise, when the throttle delay has
		// past, pending work will be worked again.
		if (!this.throttler.value) {
			this.doWork();
		}
		return true; // work accepted
	}
	doWork() {
		// Extract chunk to handle and handle it
		this.handler(this.pendingWork.splice(0, this.options.maxWorkChunkSize));
		// If we have remaining work, schedule it after a delay
		if (this.pendingWork.length > 0) {
			this.throttler.value = new RunOnceScheduler(() => {
				this.throttler.clear();
				this.doWork();
			}, this.options.throttleDelay);
			this.throttler.value.schedule();
		}
	}
	dispose() {
		super.dispose();
		this.disposed = true;
	}
}
exports.ThrottledWorker = ThrottledWorker;
(function () {
	if (typeof requestIdleCallback !== 'function' || typeof cancelIdleCallback !== 'function') {
		exports.runWhenIdle = (runner) => {
			(0, platform_1.setTimeout0)(() => {
				if (disposed) {
					return;
				}
				const end = Date.now() + 15; // one frame at 64fps
				runner(Object.freeze({
					didTimeout: true,
					timeRemaining() {
						return Math.max(0, end - Date.now());
					}
				}));
			});
			let disposed = false;
			return {
				dispose() {
					if (disposed) {
						return;
					}
					disposed = true;
				}
			};
		};
	}
	else {
		exports.runWhenIdle = (runner, timeout) => {
			const handle = requestIdleCallback(runner, typeof timeout === 'number' ? { timeout } : undefined);
			let disposed = false;
			return {
				dispose() {
					if (disposed) {
						return;
					}
					disposed = true;
					cancelIdleCallback(handle);
				}
			};
		};
	}
})();
/**
 * An implementation of the "idle-until-urgent"-strategy as introduced
 * here: https://philipwalton.com/articles/idle-until-urgent/
 */
class IdleValue {
	_executor;
	_handle;
	_didRun = false;
	_value;
	_error;
	constructor(executor) {
		this._executor = () => {
			try {
				this._value = executor();
			}
			catch (err) {
				this._error = err;
			}
			finally {
				this._didRun = true;
			}
		};
		this._handle = (0, exports.runWhenIdle)(() => this._executor());
	}
	dispose() {
		this._handle.dispose();
	}
	get value() {
		if (!this._didRun) {
			this._handle.dispose();
			this._executor();
		}
		if (this._error) {
			throw this._error;
		}
		return this._value;
	}
	get isInitialized() {
		return this._didRun;
	}
}
exports.IdleValue = IdleValue;
//#endregion
async function retry(task, delay, retries) {
	let lastError;
	for (let i = 0; i < retries; i++) {
		try {
			return await task();
		}
		catch (error) {
			lastError = error;
			await timeout(delay);
		}
	}
	throw lastError;
}
/**
 * @deprecated use `LimitedQueue` instead for an easier to use API
 */
class TaskSequentializer {
	_running;
	_queued;
	isRunning(taskId) {
		if (typeof taskId === 'number') {
			return this._running?.taskId === taskId;
		}
		return !!this._running;
	}
	get running() {
		return this._running?.promise;
	}
	cancelRunning() {
		this._running?.cancel();
	}
	run(taskId, promise, onCancel) {
		this._running = { taskId, cancel: () => onCancel?.(), promise };
		promise.then(() => this.doneRunning(taskId), () => this.doneRunning(taskId));
		return promise;
	}
	doneRunning(taskId) {
		if (this._running && taskId === this._running.taskId) {
			// only set running to done if the promise finished that is associated with that taskId
			this._running = undefined;
			// schedule the queued task now that we are free if we have any
			this.runQueued();
		}
	}
	runQueued() {
		if (this._queued) {
			const queued = this._queued;
			this._queued = undefined;
			// Run queued task and complete on the associated promise
			queued.run().then(queued.promiseResolve, queued.promiseReject);
		}
	}
	/**
	 * Note: the promise to schedule as next run MUST itself call `run`.
	 *       Otherwise, this sequentializer will report `false` for `isRunning`
	 *       even when this task is running. Missing this detail means that
	 *       suddenly multiple tasks will run in parallel.
	 */
	queue(run) {
		// this is our first queued task, so we create associated promise with it
		// so that we can return a promise that completes when the task has
		// completed.
		if (!this._queued) {
			let promiseResolve;
			let promiseReject;
			const promise = new Promise((resolve, reject) => {
				promiseResolve = resolve;
				promiseReject = reject;
			});
			this._queued = {
				run,
				promise,
				promiseResolve: promiseResolve,
				promiseReject: promiseReject
			};
		}
		// we have a previous queued task, just overwrite it
		else {
			this._queued.run = run;
		}
		return this._queued.promise;
	}
	hasQueued() {
		return !!this._queued;
	}
	async join() {
		return this._queued?.promise ?? this._running?.promise;
	}
}
exports.TaskSequentializer = TaskSequentializer;
//#endregion
//#region
/**
 * The `IntervalCounter` allows to count the number
 * of calls to `increment()` over a duration of
 * `interval`. This utility can be used to conditionally
 * throttle a frequent task when a certain threshold
 * is reached.
 */
class IntervalCounter {
	interval;
	nowFn;
	lastIncrementTime = 0;
	value = 0;
	constructor(interval, nowFn = () => Date.now()) {
		this.interval = interval;
		this.nowFn = nowFn;
	}
	increment() {
		const now = this.nowFn();
		// We are outside of the range of `interval` and as such
		// start counting from 0 and remember the time
		if (now - this.lastIncrementTime > this.interval) {
			this.lastIncrementTime = now;
			this.value = 0;
		}
		this.value++;
		return this.value;
	}
}
exports.IntervalCounter = IntervalCounter;
/**
 * Creates a promise whose resolution or rejection can be controlled imperatively.
 */
class DeferredPromise {
	completeCallback;
	errorCallback;
	outcome;
	get isRejected() {
		return this.outcome?.outcome === 1 /* DeferredOutcome.Rejected */;
	}
	get isResolved() {
		return this.outcome?.outcome === 0 /* DeferredOutcome.Resolved */;
	}
	get isSettled() {
		return !!this.outcome;
	}
	get value() {
		return this.outcome?.outcome === 0 /* DeferredOutcome.Resolved */ ? this.outcome?.value : undefined;
	}
	p;
	constructor() {
		this.p = new Promise((c, e) => {
			this.completeCallback = c;
			this.errorCallback = e;
		});
	}
	complete(value) {
		return new Promise(resolve => {
			this.completeCallback(value);
			this.outcome = { outcome: 0 /* DeferredOutcome.Resolved */, value };
			resolve();
		});
	}
	error(err) {
		return new Promise(resolve => {
			this.errorCallback(err);
			this.outcome = { outcome: 1 /* DeferredOutcome.Rejected */, value: err };
			resolve();
		});
	}
	cancel() {
		return this.error(new errors_1.CancellationError());
	}
}
exports.DeferredPromise = DeferredPromise;
//#endregion
//#region Promises
var Promises;
(function (Promises) {
	/**
	 * A drop-in replacement for `Promise.all` with the only difference
	 * that the method awaits every promise to either fulfill or reject.
	 *
	 * Similar to `Promise.all`, only the first error will be returned
	 * if any.
	 */
	async function settled(promises) {
		let firstError = undefined;
		const result = await Promise.all(promises.map(promise => promise.then(value => value, error => {
			if (!firstError) {
				firstError = error;
			}
			return undefined; // do not rethrow so that other promises can settle
		})));
		if (typeof firstError !== 'undefined') {
			throw firstError;
		}
		return result; // cast is needed and protected by the `throw` above
	}
	Promises.settled = settled;
	/**
	 * A helper to create a new `Promise<T>` with a body that is a promise
	 * itself. By default, an error that raises from the async body will
	 * end up as a unhandled rejection, so this utility properly awaits the
	 * body and rejects the promise as a normal promise does without async
	 * body.
	 *
	 * This method should only be used in rare cases where otherwise `async`
	 * cannot be used (e.g. when callbacks are involved that require this).
	 */
	function withAsyncBody(bodyFn) {
		// eslint-disable-next-line no-async-promise-executor
		return new Promise(async (resolve, reject) => {
			try {
				await bodyFn(resolve, reject);
			}
			catch (error) {
				reject(error);
			}
		});
	}
	Promises.withAsyncBody = withAsyncBody;
})(Promises || (exports.Promises = Promises = {}));
/**
 * A rich implementation for an `AsyncIterable<T>`.
 */
class AsyncIterableObject {
	static fromArray(items) {
		return new AsyncIterableObject((writer) => {
			writer.emitMany(items);
		});
	}
	static fromPromise(promise) {
		return new AsyncIterableObject(async (emitter) => {
			emitter.emitMany(await promise);
		});
	}
	static fromPromises(promises) {
		return new AsyncIterableObject(async (emitter) => {
			await Promise.all(promises.map(async (p) => emitter.emitOne(await p)));
		});
	}
	static merge(iterables) {
		return new AsyncIterableObject(async (emitter) => {
			await Promise.all(iterables.map(async (iterable) => {
				for await (const item of iterable) {
					emitter.emitOne(item);
				}
			}));
		});
	}
	static EMPTY = AsyncIterableObject.fromArray([]);
	_state;
	_results;
	_error;
	_onStateChanged;
	constructor(executor) {
		this._state = 0 /* AsyncIterableSourceState.Initial */;
		this._results = [];
		this._error = null;
		this._onStateChanged = new event_1.Emitter();
		queueMicrotask(async () => {
			const writer = {
				emitOne: (item) => this.emitOne(item),
				emitMany: (items) => this.emitMany(items),
				reject: (error) => this.reject(error)
			};
			try {
				await Promise.resolve(executor(writer));
				this.resolve();
			}
			catch (err) {
				this.reject(err);
			}
			finally {
				writer.emitOne = undefined;
				writer.emitMany = undefined;
				writer.reject = undefined;
			}
		});
	}
	[Symbol.asyncIterator]() {
		let i = 0;
		return {
			next: async () => {
				do {
					if (this._state === 2 /* AsyncIterableSourceState.DoneError */) {
						throw this._error;
					}
					if (i < this._results.length) {
						return { done: false, value: this._results[i++] };
					}
					if (this._state === 1 /* AsyncIterableSourceState.DoneOK */) {
						return { done: true, value: undefined };
					}
					await event_1.Event.toPromise(this._onStateChanged.event);
				} while (true);
			}
		};
	}
	static map(iterable, mapFn) {
		return new AsyncIterableObject(async (emitter) => {
			for await (const item of iterable) {
				emitter.emitOne(mapFn(item));
			}
		});
	}
	map(mapFn) {
		return AsyncIterableObject.map(this, mapFn);
	}
	static filter(iterable, filterFn) {
		return new AsyncIterableObject(async (emitter) => {
			for await (const item of iterable) {
				if (filterFn(item)) {
					emitter.emitOne(item);
				}
			}
		});
	}
	filter(filterFn) {
		return AsyncIterableObject.filter(this, filterFn);
	}
	static coalesce(iterable) {
		return AsyncIterableObject.filter(iterable, item => !!item);
	}
	coalesce() {
		return AsyncIterableObject.coalesce(this);
	}
	static async toPromise(iterable) {
		const result = [];
		for await (const item of iterable) {
			result.push(item);
		}
		return result;
	}
	toPromise() {
		return AsyncIterableObject.toPromise(this);
	}
	/**
	 * The value will be appended at the end.
	 *
	 * **NOTE** If `resolve()` or `reject()` have already been called, this method has no effect.
	 */
	emitOne(value) {
		if (this._state !== 0 /* AsyncIterableSourceState.Initial */) {
			return;
		}
		// it is important to add new values at the end,
		// as we may have iterators already running on the array
		this._results.push(value);
		this._onStateChanged.fire();
	}
	/**
	 * The values will be appended at the end.
	 *
	 * **NOTE** If `resolve()` or `reject()` have already been called, this method has no effect.
	 */
	emitMany(values) {
		if (this._state !== 0 /* AsyncIterableSourceState.Initial */) {
			return;
		}
		// it is important to add new values at the end,
		// as we may have iterators already running on the array
		this._results = this._results.concat(values);
		this._onStateChanged.fire();
	}
	/**
	 * Calling `resolve()` will mark the result array as complete.
	 *
	 * **NOTE** `resolve()` must be called, otherwise all consumers of this iterable will hang indefinitely, similar to a non-resolved promise.
	 * **NOTE** If `resolve()` or `reject()` have already been called, this method has no effect.
	 */
	resolve() {
		if (this._state !== 0 /* AsyncIterableSourceState.Initial */) {
			return;
		}
		this._state = 1 /* AsyncIterableSourceState.DoneOK */;
		this._onStateChanged.fire();
	}
	/**
	 * Writing an error will permanently invalidate this iterable.
	 * The current users will receive an error thrown, as will all future users.
	 *
	 * **NOTE** If `resolve()` or `reject()` have already been called, this method has no effect.
	 */
	reject(error) {
		if (this._state !== 0 /* AsyncIterableSourceState.Initial */) {
			return;
		}
		this._state = 2 /* AsyncIterableSourceState.DoneError */;
		this._error = error;
		this._onStateChanged.fire();
	}
}
exports.AsyncIterableObject = AsyncIterableObject;
class CancelableAsyncIterableObject extends AsyncIterableObject {
	_source;
	constructor(_source, executor) {
		super(executor);
		this._source = _source;
	}
	cancel() {
		this._source.cancel();
	}
}
exports.CancelableAsyncIterableObject = CancelableAsyncIterableObject;
function createCancelableAsyncIterable(callback) {
	const source = new cancellation_1.CancellationTokenSource();
	const innerIterable = callback(source.token);
	return new CancelableAsyncIterableObject(source, async (emitter) => {
		const subscription = source.token.onCancellationRequested(() => {
			subscription.dispose();
			source.dispose();
			emitter.reject(new errors_1.CancellationError());
		});
		try {
			for await (const item of innerIterable) {
				if (source.token.isCancellationRequested) {
					// canceled in the meantime
					return;
				}
				emitter.emitOne(item);
			}
			subscription.dispose();
			source.dispose();
		}
		catch (err) {
			subscription.dispose();
			source.dispose();
			emitter.reject(err);
		}
	});
}
//#endregion
