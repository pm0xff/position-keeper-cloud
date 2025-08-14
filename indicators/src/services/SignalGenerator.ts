// src/services/SignalGenerator.ts
import { TrendSignal } from '../types/shared';

interface SignalConfig {
  MIN_VERTEX_AGE: number;      // minutes
  MAX_VERTEX_AGE: number;      // minutes
  SIGNAL_EXPIRY_MINUTES: number;
  MIN_MAGNITUDE: number;       // percentage
  STABILITY_BUFFER: number;    // number of confirmations
  CONFIDENCE_THRESHOLD: number;
  WEIGHTED_ALPHA: number;      // weighting factor for recent data
}

interface PatternResult {
  direction: 'BUY' | 'SELL' | 'NONE';
  confidence: number;
  reason: string;
  vertexAge?: number;
  trendStrength?: 'STRONG' | 'MODERATE' | 'WEAK';
  pattern?: 'U_SHAPED' | 'INVERTED_U';
  magnitude?: number;
  expiresAt: number;
}

export class SignalGenerator {
  private static readonly DEFAULT_CONFIG: SignalConfig = {
    MIN_VERTEX_AGE: 20,
    MAX_VERTEX_AGE: 120,
    SIGNAL_EXPIRY_MINUTES: 15,
    MIN_MAGNITUDE: 1.5,
    STABILITY_BUFFER: 3,
    CONFIDENCE_THRESHOLD: 0.6,
    WEIGHTED_ALPHA: 0.5
  };

  // Signal stability tracking
  private signalHistory = new Map<string, TrendSignal[]>();
  
  constructor(private config: Partial<SignalConfig> = {}) {
    this.config = { ...SignalGenerator.DEFAULT_CONFIG, ...config };
  }

  /**
   * Analyze price data for trading signals using quadratic pattern recognition
   */
  generateSignal(symbol: string, prices: number[], lastUpdated: number = Date.now()): TrendSignal {
    if (prices.length < 360) {
      return this.createSignal('NONE', 0, `Insufficient data (${prices.length}/360 points)`, lastUpdated);
    }

    try {
      // Analyze the pattern using the last 360 minutes (6 hours)
      const patternResult = this.analyzeQuadraticPattern(prices.slice(-360), lastUpdated);
      
      // Apply stability filter to reduce noise
      const stabilizedSignal = this.applyStabilityFilter(symbol, patternResult, lastUpdated);
      
      return stabilizedSignal;

    } catch (error) {
      console.error(`Signal generation failed for ${symbol}:`, error);
      return this.createSignal('NONE', 0, `Analysis error: ${error instanceof Error ? error.message : 'Unknown'}`, lastUpdated);
    }
  }

  /**
   * Quadratic pattern analysis to detect U-shaped and ∩-shaped patterns
   */
  private analyzeQuadraticPattern(prices: number[], timestamp: number): PatternResult {
    const y = [...prices]; // Work with a copy
    const x = y.map((_, i) => i);
    const end = y[y.length - 1];

    // Perform quadratic regression: y = ax² + bx + c
    const [a, b, c] = this.quadraticFit(x, y);
    
    // Calculate vertex (turning point)
    const vertexX = -b / (2 * a);
    const vertexIdx = Math.max(0, Math.min(prices.length - 1, Math.round(vertexX)));
    const vertexPrice = y[vertexIdx];

    // Calculate vertex age in minutes
    const minutesSinceVertex = prices.length - 1 - vertexIdx;

    // Calculate price change from vertex to current
    const pctChangeVertexToRecent = ((end - vertexPrice) / vertexPrice) * 100;
    const isUShaped = a > 0;
    const isInvertedUShaped = a < 0;

    console.log(`📊 ${this.getCurrentTime()} Pattern Analysis: ${isUShaped ? 'U' : '∩'}-shaped, vertex ${minutesSinceVertex}min ago, magnitude ${pctChangeVertexToRecent.toFixed(2)}%`);

    // Validate vertex age
    if (minutesSinceVertex < this.config.MIN_VERTEX_AGE!) {
      return {
        direction: 'NONE',
        confidence: 0.1,
        reason: `Vertex too recent (${minutesSinceVertex}min < ${this.config.MIN_VERTEX_AGE}min)`,
        expiresAt: timestamp + (this.config.SIGNAL_EXPIRY_MINUTES! * 60 * 1000)
      };
    }

    let direction: 'BUY' | 'SELL' | 'NONE' = 'NONE';
    let confidence = 0;
    let reason = '';
    let trendStrength: 'STRONG' | 'MODERATE' | 'WEAK' = 'WEAK';

    if (isUShaped && pctChangeVertexToRecent > this.config.MIN_MAGNITUDE!) {
      // U-shaped recovery confirmed
      direction = 'BUY';
      confidence = Math.min(0.95, 0.5 + Math.abs(pctChangeVertexToRecent) / 15);
      reason = `U-shaped recovery confirmed (${minutesSinceVertex}min post-vertex, ${this.formatPercentage(pctChangeVertexToRecent)})`;
      trendStrength = pctChangeVertexToRecent > 8 ? 'STRONG' : pctChangeVertexToRecent > 5 ? 'MODERATE' : 'WEAK';
      
    } else if (isInvertedUShaped && pctChangeVertexToRecent < -this.config.MIN_MAGNITUDE!) {
      // ∩-shaped decline confirmed
      direction = 'SELL';
      confidence = Math.min(0.95, 0.5 + Math.abs(pctChangeVertexToRecent) / 20);
      reason = `∩-shaped decline confirmed (${minutesSinceVertex}min post-vertex, ${this.formatPercentage(pctChangeVertexToRecent)})`;
      trendStrength = pctChangeVertexToRecent < -8 ? 'STRONG' : pctChangeVertexToRecent < -5 ? 'MODERATE' : 'WEAK';
      
    } else {
      // Pattern detected but insufficient magnitude
      const shapeDesc = isUShaped ? 'U-shaped' : '∩-shaped';
      reason = `${shapeDesc} pattern present but insufficient magnitude (${minutesSinceVertex}min post-vertex, ${this.formatPercentage(pctChangeVertexToRecent)})`;
    }

    // Check for aged patterns
    if (direction === 'BUY' && minutesSinceVertex > this.config.MAX_VERTEX_AGE!) {
      return {
        direction: 'NONE',
        confidence: 0,
        reason: `Pattern too aged for BUY (>${this.config.MAX_VERTEX_AGE}min)`,
        expiresAt: timestamp + (this.config.SIGNAL_EXPIRY_MINUTES! * 60 * 1000)
      };
    }

    return {
      direction,
      confidence: Math.round(confidence * 100) / 100,
      reason,
      vertexAge: minutesSinceVertex,
      trendStrength,
      pattern: isUShaped ? 'U_SHAPED' : 'INVERTED_U',
      magnitude: Math.abs(pctChangeVertexToRecent),
      expiresAt: timestamp + (this.config.SIGNAL_EXPIRY_MINUTES! * 60 * 1000)
    };
  }

  /**
   * Apply stability filter to reduce signal noise
   */
  private applyStabilityFilter(symbol: string, patternResult: PatternResult, timestamp: number): TrendSignal {
    const baseSignal = this.createSignal(
      patternResult.direction,
      patternResult.confidence,
      patternResult.reason,
      timestamp,
      {
        vertexAge: patternResult.vertexAge,
        trendStrength: patternResult.trendStrength,
        pattern: patternResult.pattern,
        magnitude: patternResult.magnitude
      }
    );

    if (!this.signalHistory.has(symbol)) {
      this.signalHistory.set(symbol, []);
    }

    const history = this.signalHistory.get(symbol)!;
    history.push(baseSignal);

    // Keep only recent history for stability analysis
    if (history.length > this.config.STABILITY_BUFFER! * 2) {
      history.splice(0, history.length - (this.config.STABILITY_BUFFER! * 2));
    }

    // Require consistent signal for full confidence
    if (history.length >= this.config.STABILITY_BUFFER!) {
      const recentSignals = history.slice(-this.config.STABILITY_BUFFER!);
      const allSameDirection = recentSignals.every(s => s.direction === baseSignal.direction);
      const avgConfidence = recentSignals.reduce((sum, s) => sum + s.confidence, 0) / recentSignals.length;

      if (allSameDirection && baseSignal.direction !== 'NONE') {
        return {
          ...baseSignal,
          confidence: avgConfidence,
          reason: `${baseSignal.reason} (${this.config.STABILITY_BUFFER}x confirmed)`,
          stable: true
        };
      }
    }

    // Return signal with reduced confidence if not stable
    return {
      ...baseSignal,
      confidence: baseSignal.confidence * 0.8,
      reason: `${baseSignal.reason} (awaiting confirmation)`,
      stable: false
    };
  }

  /**
   * Create a standard signal object
   */
  private createSignal(
    direction: 'BUY' | 'SELL' | 'NONE',
    confidence: number,
    reason: string,
    timestamp: number,
    metadata: Partial<TrendSignal> = {}
  ): TrendSignal {
    const localTimestamp = this.toLocalTimezone(timestamp);
    
    return {
      direction,
      confidence: Math.round(confidence * 100) / 100,
      firstDetected: localTimestamp,
      lastEvaluated: localTimestamp,
      expiresAt: this.createExpiryTimestamp(timestamp),
      reason,
      ...metadata
    };
  }

  /**
   * Quadratic least squares fitting
   */
  private quadraticFit(x: number[], y: number[]): number[] {
    // Build design matrix for y = ax² + bx + c
    const X = x.map(xi => [xi * xi, xi, 1]);
    const XT = this.transpose(X);
    const XTX = this.multiply(XT, X);
    const XTY = this.multiplyVec(XT, y);
    
    return this.solveLinearSystem(XTX, XTY);
  }

  /**
   * Matrix operations for quadratic fitting
   */
  private transpose(A: number[][]): number[][] {
    return A[0].map((_, i) => A.map(row => row[i]));
  }

  private multiply(A: number[][], B: number[][]): number[][] {
    return A.map(row =>
      B[0].map((_, j) => row.reduce((sum, val, k) => sum + val * B[k][j], 0))
    );
  }

  private multiplyVec(A: number[][], v: number[]): number[] {
    return A.map(row => row.reduce((sum, val, i) => sum + val * v[i], 0));
  }

  private solveLinearSystem(A: number[][], b: number[]): number[] {
    const m = A.length;
    const x = new Array(m);
    const M = A.map((row, i) => [...row, b[i]]);

    // Gaussian elimination with partial pivoting
    for (let i = 0; i < m; i++) {
      let maxRow = i;
      for (let k = i + 1; k < m; k++) {
        if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) maxRow = k;
      }
      [M[i], M[maxRow]] = [M[maxRow], M[i]];

      for (let k = i + 1; k < m; k++) {
        const factor = M[k][i] / M[i][i];
        for (let j = i; j <= m; j++) M[k][j] -= factor * M[i][j];
      }
    }

    // Back substitution
    for (let i = m - 1; i >= 0; i--) {
      x[i] = M[i][m] / M[i][i];
      for (let k = i - 1; k >= 0; k--) M[k][m] -= M[k][i] * x[i];
    }

    return x;
  }

  /**
   * Utility methods
   */
  private formatPercentage(pct: number): string {
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
  }

  private toLocalTimezone(timestamp: number): string {
    return new Date(timestamp).toLocaleString('en-IE', {
      timeZone: 'Europe/Dublin',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  }

  private createExpiryTimestamp(baseTime: number = Date.now()): string {
    const expiryTime = baseTime + (this.config.SIGNAL_EXPIRY_MINUTES! * 60 * 1000);
    return this.toLocalTimezone(expiryTime);
  }

  private getCurrentTime(): string {
    return new Date().toLocaleTimeString('en-IE', {
      timeZone: 'Europe/Dublin',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  /**
   * Public methods for configuration management
   */
  updateConfig(newConfig: Partial<SignalConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('📊 Signal generator configuration updated:', newConfig);
  }

  getConfig(): SignalConfig {
    return { ...this.config } as SignalConfig;
  }

  /**
   * Clear signal history for a symbol (useful for testing or resets)
   */
  clearHistory(symbol?: string): void {
    if (symbol) {
      this.signalHistory.delete(symbol);
      console.log(`📊 Cleared signal history for ${symbol}`);
    } else {
      this.signalHistory.clear();
      console.log('📊 Cleared all signal history');
    }
  }

  /**
   * Get signal statistics for monitoring
   */
  getStatistics(): {
    symbolsTracked: number;
    totalSignalsGenerated: number;
    averageHistoryLength: number;
  } {
    const symbolsTracked = this.signalHistory.size;
    const totalSignalsGenerated = Array.from(this.signalHistory.values())
      .reduce((sum, history) => sum + history.length, 0);
    const averageHistoryLength = symbolsTracked > 0 ? totalSignalsGenerated / symbolsTracked : 0;

    return {
      symbolsTracked,
      totalSignalsGenerated,
      averageHistoryLength: Math.round(averageHistoryLength * 10) / 10
    };
  }
}