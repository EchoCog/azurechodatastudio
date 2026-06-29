"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataPatternAgent = void 0;
const lifecycle_1 = require("vs/base/common/lifecycle");
const event_1 = require("vs/base/common/event");
const log_1 = require("vs/platform/log/common/log");
const zonecogService_1 = require("sql/workbench/services/zonecog/common/zonecogService");
const zonecogService_2 = require("sql/workbench/services/zonecog/common/zonecogService");
/**
 * Data Pattern Agent Implementation.
 * Provides statistical pattern recognition in query results.
 */
let DataPatternAgent = class DataPatternAgent extends lifecycle_1.Disposable {
    logService;
    membraneService;
    hypergraphStore;
    _serviceBrand;
    id = 'data-pattern-agent';
    name = 'Data Pattern Analyzer';
    description = 'Statistical pattern recognition and anomaly detection';
    _status = 'idle';
    _currentLoad = 0;
    _onDidChangeStatus = this._register(new event_1.Emitter());
    onDidChangeStatus = this._onDidChangeStatus.event;
    constructor(logService, membraneService, hypergraphStore) {
        super();
        this.logService = logService;
        this.membraneService = membraneService;
        this.hypergraphStore = hypergraphStore;
        this.logService.info('[DataPatternAgent] Initialized');
    }
    getCapabilities() {
        return {
            canPerceive: true,
            canReason: true,
            canAct: true,
            supportedActions: ['detect_patterns', 'generate_summary', 'identify_anomalies', 'suggest_quality'],
            maxConcurrentTasks: 2,
        };
    }
    getStatus() {
        return this._status;
    }
    getCurrentLoad() {
        return this._currentLoad;
    }
    async perceive(input) {
        this.membraneService.recordActivity('cerebral');
        if (Array.isArray(input) && input.length > 0) {
            const summary = await this.generateSummary(input);
            const node = {
                node_type: 'data_perception',
                content: JSON.stringify({ rowCount: input.length, qualityScore: summary.qualityScore }),
                links: [],
                metadata: {
                    perceived_at: Date.now(),
                    agent: this.id,
                },
                salience_score: summary.qualityScore < 0.7 ? 0.8 : 0.5,
            };
            await this.hypergraphStore.addNode(node);
        }
    }
    async decide(context) {
        this.membraneService.recordActivity('cerebral');
        if (context.data && Array.isArray(context.data)) {
            return {
                action: 'detect_patterns',
                target: JSON.stringify(context.data),
                parameters: {},
                confidence: 0.85,
            };
        }
        return null;
    }
    async execute(action) {
        this.membraneService.recordActivity('somatic');
        this._status = 'active';
        this._currentLoad += 0.5;
        this._onDidChangeStatus.fire(this._status);
        try {
            const data = JSON.parse(action.target);
            switch (action.action) {
                case 'detect_patterns':
                    return await this.detectPatterns(data);
                case 'generate_summary':
                    return await this.generateSummary(data);
                case 'identify_anomalies':
                    return await this.identifyAnomalies(data);
                case 'suggest_quality':
                    return await this.suggestDataQualityImprovements(data);
                default:
                    throw new Error(`Unknown action: ${action.action}`);
            }
        }
        finally {
            this._currentLoad = Math.max(0, this._currentLoad - 0.5);
            this._status = this._currentLoad > 0 ? 'active' : 'idle';
            this._onDidChangeStatus.fire(this._status);
        }
    }
    async detectPatterns(data) {
        this.membraneService.recordActivity('cerebral');
        this.logService.info(`[DataPatternAgent] Detecting patterns in ${data.length} rows...`);
        if (data.length === 0) {
            return [];
        }
        const patterns = [];
        const columns = Object.keys(data[0]);
        for (const column of columns) {
            const values = data.map(row => row[column]).filter(v => v !== null && v !== undefined);
            // Detect numeric patterns
            if (this._isNumeric(values)) {
                const numValues = values.map(Number);
                patterns.push(...this._detectNumericPatterns(column, numValues));
            }
            // Detect categorical patterns
            if (this._isCategorical(values)) {
                patterns.push(...this._detectCategoricalPatterns(column, values));
            }
            // Detect temporal patterns
            if (this._isTemporal(values)) {
                patterns.push(...this._detectTemporalPatterns(column, values));
            }
        }
        // Detect correlations between columns
        patterns.push(...this._detectCorrelations(data, columns));
        // Store patterns in hypergraph
        await this._storePatterns(patterns);
        return patterns;
    }
    async generateSummary(data) {
        this.membraneService.recordActivity('cerebral');
        this.logService.info(`[DataPatternAgent] Generating summary for ${data.length} rows...`);
        if (data.length === 0) {
            return {
                rowCount: 0,
                columns: [],
                qualityScore: 0,
            };
        }
        const columns = Object.keys(data[0]);
        const columnSummaries = [];
        let totalNullPercentage = 0;
        for (const column of columns) {
            const values = data.map(row => row[column]);
            const nullCount = values.filter(v => v === null || v === undefined).length;
            const nullPercentage = (nullCount / values.length) * 100;
            totalNullPercentage += nullPercentage;
            const nonNullValues = values.filter(v => v !== null && v !== undefined);
            const distinctCount = new Set(nonNullValues).size;
            const summary = {
                name: column,
                type: this._inferType(nonNullValues),
                nullPercentage,
                distinctCount,
            };
            // Add statistics for numeric columns
            if (this._isNumeric(nonNullValues)) {
                const numValues = nonNullValues.map(Number);
                summary.statistics = {
                    min: Math.min(...numValues),
                    max: Math.max(...numValues),
                    avg: numValues.reduce((a, b) => a + b, 0) / numValues.length,
                    stddev: this._calculateStdDev(numValues),
                };
            }
            columnSummaries.push(summary);
        }
        // Calculate overall quality score
        const avgNullPercentage = totalNullPercentage / columns.length;
        const qualityScore = Math.max(0, 1 - (avgNullPercentage / 100));
        return {
            rowCount: data.length,
            columns: columnSummaries,
            qualityScore,
        };
    }
    async identifyAnomalies(data) {
        this.membraneService.recordActivity('cerebral');
        this.logService.info(`[DataPatternAgent] Identifying anomalies in ${data.length} rows...`);
        if (data.length === 0) {
            return [];
        }
        const anomalies = [];
        const columns = Object.keys(data[0]);
        for (const column of columns) {
            const values = data.map(row => row[column]);
            // Check for null/missing values
            const nullIndices = values
                .map((v, i) => v === null || v === undefined ? i : -1)
                .filter(i => i >= 0);
            if (nullIndices.length > 0 && nullIndices.length < values.length * 0.5) {
                anomalies.push({
                    type: 'missing',
                    severity: nullIndices.length > values.length * 0.1 ? 'high' : 'low',
                    description: `Column '${column}' has ${nullIndices.length} missing values (${((nullIndices.length / values.length) * 100).toFixed(1)}%)`,
                    affectedRows: nullIndices.slice(0, 100), // Limit to first 100
                });
            }
            // Check for numeric outliers
            const nonNullValues = values.filter(v => v !== null && v !== undefined);
            if (this._isNumeric(nonNullValues)) {
                const numValues = nonNullValues.map(Number);
                const outliers = this._findOutliers(numValues, values);
                if (outliers.indices.length > 0) {
                    anomalies.push({
                        type: 'outlier',
                        severity: outliers.indices.length > values.length * 0.05 ? 'high' : 'medium',
                        // allow-any-unicode-next-line
                        description: `Column '${column}' has ${outliers.indices.length} outliers (outside ${outliers.threshold.toFixed(2)}σ)`,
                        affectedRows: outliers.indices.slice(0, 100),
                    });
                }
            }
            // Check for inconsistent values (case variations, whitespace)
            if (typeof nonNullValues[0] === 'string') {
                const inconsistencies = this._findInconsistencies(nonNullValues, values);
                if (inconsistencies.length > 0) {
                    anomalies.push({
                        type: 'inconsistent',
                        severity: 'low',
                        description: `Column '${column}' has inconsistent values: ${inconsistencies.join(', ')}`,
                    });
                }
            }
        }
        // Check for duplicate rows
        const duplicates = this._findDuplicateRows(data);
        if (duplicates.length > 0) {
            anomalies.push({
                type: 'duplicate',
                severity: duplicates.length > data.length * 0.1 ? 'high' : 'medium',
                description: `Found ${duplicates.length} duplicate rows`,
                affectedRows: duplicates.slice(0, 100),
            });
        }
        return anomalies;
    }
    async suggestDataQualityImprovements(data) {
        this.membraneService.recordActivity('cerebral');
        this.logService.info('[DataPatternAgent] Suggesting data quality improvements...');
        const suggestions = [];
        const summary = await this.generateSummary(data);
        const anomalies = await this.identifyAnomalies(data);
        // Suggest based on null percentages
        const highNullColumns = summary.columns.filter(c => c.nullPercentage > 20);
        if (highNullColumns.length > 0) {
            suggestions.push(`Address high null rates in columns: ${highNullColumns.map(c => `${c.name} (${c.nullPercentage.toFixed(1)}%)`).join(', ')}`);
        }
        // Suggest based on distinct count
        const lowCardinalityColumns = summary.columns.filter(c => c.distinctCount === 1 && data.length > 10);
        if (lowCardinalityColumns.length > 0) {
            suggestions.push(`Review constant-value columns (possibly unnecessary): ${lowCardinalityColumns.map(c => c.name).join(', ')}`);
        }
        // Suggest based on anomalies
        const outlierAnomalies = anomalies.filter(a => a.type === 'outlier');
        if (outlierAnomalies.length > 0) {
            suggestions.push('Review and validate outlier values - they may indicate data quality issues or require special handling');
        }
        const inconsistencyAnomalies = anomalies.filter(a => a.type === 'inconsistent');
        if (inconsistencyAnomalies.length > 0) {
            suggestions.push('Standardize text values (consistent casing, trimmed whitespace)');
        }
        const duplicateAnomalies = anomalies.filter(a => a.type === 'duplicate');
        if (duplicateAnomalies.length > 0) {
            suggestions.push('Remove or investigate duplicate rows');
        }
        // General suggestions
        if (summary.qualityScore < 0.8) {
            suggestions.push('Consider implementing data validation rules at the source');
        }
        return suggestions;
    }
    _isNumeric(values) {
        if (values.length === 0)
            return false;
        return values.every(v => !isNaN(Number(v)));
    }
    _isCategorical(values) {
        if (values.length === 0)
            return false;
        const distinctRatio = new Set(values).size / values.length;
        return distinctRatio < 0.5 && typeof values[0] === 'string';
    }
    _isTemporal(values) {
        if (values.length === 0)
            return false;
        const datePattern = /^\d{4}-\d{2}-\d{2}|^\d{2}\/\d{2}\/\d{4}/;
        return values.some(v => typeof v === 'string' && datePattern.test(v));
    }
    _inferType(values) {
        if (values.length === 0)
            return 'unknown';
        if (this._isNumeric(values)) {
            return values.some(v => String(v).includes('.')) ? 'decimal' : 'integer';
        }
        if (this._isTemporal(values)) {
            return 'datetime';
        }
        if (typeof values[0] === 'boolean') {
            return 'boolean';
        }
        return 'string';
    }
    _calculateStdDev(values) {
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
        return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
    }
    _detectNumericPatterns(column, values) {
        const patterns = [];
        // Detect trend
        if (values.length >= 5) {
            const trend = this._detectTrend(values);
            if (trend.detected) {
                patterns.push({
                    type: 'trend',
                    description: `Column '${column}' shows ${trend.direction} trend (slope: ${trend.slope.toFixed(4)})`,
                    confidence: trend.confidence,
                    columns: [column],
                });
            }
        }
        // Detect clusters
        const clusters = this._detectClusters(values);
        if (clusters > 1) {
            patterns.push({
                type: 'cluster',
                description: `Column '${column}' appears to have ${clusters} distinct clusters`,
                confidence: 0.7,
                columns: [column],
            });
        }
        return patterns;
    }
    _detectCategoricalPatterns(column, values) {
        const patterns = [];
        const counts = new Map();
        for (const value of values) {
            counts.set(String(value), (counts.get(String(value)) || 0) + 1);
        }
        // Check for dominant category
        const sortedCounts = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
        if (sortedCounts.length > 0) {
            const dominantRatio = sortedCounts[0][1] / values.length;
            if (dominantRatio > 0.7) {
                patterns.push({
                    type: 'cluster',
                    description: `Column '${column}' is dominated by '${sortedCounts[0][0]}' (${(dominantRatio * 100).toFixed(1)}%)`,
                    confidence: dominantRatio,
                    columns: [column],
                });
            }
        }
        return patterns;
    }
    _detectTemporalPatterns(column, values) {
        const patterns = [];
        // Try to parse as dates
        const dates = values
            .map(v => new Date(v))
            .filter(d => !isNaN(d.getTime()));
        if (dates.length >= 5) {
            // Check for seasonality (day of week pattern)
            const dayOfWeekCounts = new Array(7).fill(0);
            for (const date of dates) {
                dayOfWeekCounts[date.getDay()]++;
            }
            const maxDay = Math.max(...dayOfWeekCounts);
            const minDay = Math.min(...dayOfWeekCounts);
            if (maxDay / (minDay + 1) > 2) {
                patterns.push({
                    type: 'seasonality',
                    description: `Column '${column}' shows weekly seasonality pattern`,
                    confidence: 0.65,
                    columns: [column],
                });
            }
        }
        return patterns;
    }
    _detectCorrelations(data, columns) {
        const patterns = [];
        const numericColumns = columns.filter(col => this._isNumeric(data.map(row => row[col]).filter(v => v !== null && v !== undefined)));
        // Check pairs of numeric columns for correlation
        for (let i = 0; i < numericColumns.length; i++) {
            for (let j = i + 1; j < numericColumns.length; j++) {
                const col1 = numericColumns[i];
                const col2 = numericColumns[j];
                const correlation = this._calculateCorrelation(data.map(row => Number(row[col1])), data.map(row => Number(row[col2])));
                if (Math.abs(correlation) > 0.7) {
                    patterns.push({
                        type: 'correlation',
                        description: `Strong ${correlation > 0 ? 'positive' : 'negative'} correlation between '${col1}' and '${col2}' (r=${correlation.toFixed(3)})`,
                        confidence: Math.abs(correlation),
                        columns: [col1, col2],
                    });
                }
            }
        }
        return patterns;
    }
    _detectTrend(values) {
        // Simple linear regression
        const n = values.length;
        const x = Array.from({ length: n }, (_, i) => i);
        const sumX = x.reduce((a, b) => a + b, 0);
        const sumY = values.reduce((a, b) => a + b, 0);
        const sumXY = x.reduce((acc, xi, i) => acc + xi * values[i], 0);
        const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;
        // Calculate R-squared
        const yMean = sumY / n;
        const ssTotal = values.reduce((acc, yi) => acc + Math.pow(yi - yMean, 2), 0);
        const ssResidual = values.reduce((acc, yi, i) => acc + Math.pow(yi - (slope * i + intercept), 2), 0);
        const rSquared = 1 - (ssResidual / ssTotal);
        return {
            detected: Math.abs(slope) > 0 && rSquared > 0.5,
            direction: slope > 0 ? 'upward' : 'downward',
            slope,
            confidence: rSquared,
        };
    }
    _detectClusters(values) {
        // Simple cluster detection using histogram bins
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min;
        if (range === 0)
            return 1;
        const binCount = Math.min(10, Math.ceil(Math.sqrt(values.length)));
        const binWidth = range / binCount;
        const bins = new Array(binCount).fill(0);
        for (const value of values) {
            const binIndex = Math.min(binCount - 1, Math.floor((value - min) / binWidth));
            bins[binIndex]++;
        }
        // Count non-empty bins separated by empty bins
        let clusters = 0;
        let inCluster = false;
        for (const count of bins) {
            if (count > 0 && !inCluster) {
                clusters++;
                inCluster = true;
            }
            else if (count === 0) {
                inCluster = false;
            }
        }
        return clusters;
    }
    _calculateCorrelation(x, y) {
        const n = x.length;
        if (n === 0)
            return 0;
        const sumX = x.reduce((a, b) => a + b, 0);
        const sumY = y.reduce((a, b) => a + b, 0);
        const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
        const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);
        const sumY2 = y.reduce((acc, yi) => acc + yi * yi, 0);
        const numerator = n * sumXY - sumX * sumY;
        const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
        return denominator === 0 ? 0 : numerator / denominator;
    }
    _findOutliers(numValues, allValues) {
        const mean = numValues.reduce((a, b) => a + b, 0) / numValues.length;
        const stdDev = this._calculateStdDev(numValues);
        const threshold = 3; // 3 standard deviations
        const indices = [];
        for (let i = 0; i < allValues.length; i++) {
            const value = allValues[i];
            if (value !== null && value !== undefined) {
                const z = Math.abs(Number(value) - mean) / stdDev;
                if (z > threshold) {
                    indices.push(i);
                }
            }
        }
        return { indices, threshold };
    }
    _findInconsistencies(strValues, allValues) {
        const inconsistencies = [];
        const normalized = new Map();
        for (const value of strValues) {
            const norm = String(value).toLowerCase().trim();
            if (!normalized.has(norm)) {
                normalized.set(norm, []);
            }
            normalized.get(norm).push(value);
        }
        // Find cases where same normalized value has different original forms
        for (const [, originals] of normalized) {
            const unique = [...new Set(originals)];
            if (unique.length > 1) {
                inconsistencies.push(`"${unique.slice(0, 3).join('" vs "')}"${unique.length > 3 ? ` (and ${unique.length - 3} more)` : ''}`);
            }
        }
        return inconsistencies.slice(0, 5); // Limit to 5 examples
    }
    _findDuplicateRows(data) {
        const seen = new Map();
        const duplicates = [];
        for (let i = 0; i < data.length; i++) {
            const key = JSON.stringify(data[i]);
            if (seen.has(key)) {
                duplicates.push(i);
            }
            else {
                seen.set(key, i);
            }
        }
        return duplicates;
    }
    async _storePatterns(patterns) {
        for (const pattern of patterns) {
            const node = {
                node_type: 'data_pattern',
                content: JSON.stringify(pattern),
                links: [],
                metadata: {
                    pattern_type: pattern.type,
                    confidence: pattern.confidence,
                    detected_at: Date.now(),
                    agent: this.id,
                },
                salience_score: pattern.confidence,
            };
            await this.hypergraphStore.addNode(node);
        }
    }
};
exports.DataPatternAgent = DataPatternAgent;
exports.DataPatternAgent = DataPatternAgent = __decorate([
    __param(0, log_1.ILogService),
    __param(1, zonecogService_1.ICognitiveMembraneService),
    __param(2, zonecogService_2.IHypergraphStore)
], DataPatternAgent);
