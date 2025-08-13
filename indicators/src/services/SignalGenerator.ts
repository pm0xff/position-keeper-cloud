// src/services/SignalGenerator.ts
import { TrendSignal, toLocalTimezone, createExpiryTimestamp } from '../types/shared';

export class SignalGenerator {
  private signalHistory = new Map<string, TrendSignal[]>();
  
  // Signal generation configuration
  private readonly config = {
    MIN_VERTEX_AGE: parseInt(process.env.MIN_VERTEX_AGE || '20'),
    MAX_VERTEX_AGE: parseInt(process.env.MAX_VERTEX_AGE || '120'),
    SIGNAL_EXPIRY_MINUTES: parseInt(process.env.SIGNAL_EXPIRY_MINUTES || '15'),
    STABILITY_BUFFER: parseInt(process.env.STABILITY_BUFFER || '3'),
    ALPHA: parseFloat(process.env.WEIGHTED_ALPHA || '0.5'),
    WEIGHTED_POLYNOMIAL: process.env.WEIGHTED_POLYNOMIAL === 'TRUE'
  };

  generateSignal(symbol: string, prices: number[]): TrendSignal {
    if (prices.length < 360) {
      return this.createSignal('NONE', 0, `Insufficient data (${prices.length}/360 points)`, Date.now());
    }

    // Use last 360 minutes (6 hours) for trend analysis
    const y = prices.slice(-360);
    const x = y.map((_, i) => i);
    
    // Apply weighted polynomial fitting
    const weights = this.calculateWeights(y.length, this.config.ALPHA);
    const [a, b, c] = this.weightedQuadraticFit(x, y, weights);
    
    const vertexX = -b / (2 * a);
    const vertexIdx = Math.max(0, Math.min(359, Math.round(vertexX)));
    const vertexPrice = y[vertexIdx];
    const endPrice = y[y.length - 1];

    const minutesSinceVertex = 360 - vertexIdx;
    const pctChangeVertexToRecent = ((endPrice - vertexPrice) / vertexPrice) * 100;
    const isUShaped = a > 0;

    console.log(`${symbol} vertex at index ${vertexIdx} (${minutesSinceVertex}min old) shape ${isUShaped?'U':'∩'} mag ${pctChangeVertexToRecent.toFixed(2)}%`);
    
    // Signal generation logic
    if (minutesSinceVertex < this.config.MIN_VERTEX_AGE) {
      return this.createSignal('NONE', 0.1, `Vertex too recent (${minutesSinceVertex}min < ${this.config.MIN_VERTEX_AGE}min)`, Date.now());
    }

    let direction: 'BUY' | 'SELL' | 'NONE' = 'NONE';
    let confidence = 0;
    let reason = '';
    let trendStrength: 'STRONG' | 'MODERATE' | 'WEAK' = 'WEAK';

    if (isUShaped && pctChangeVertexToRecent > 1.5) {
      // U-shaped recovery confirmed
      direction = 'BUY';
      confidence = Math.min(0.95, 0.5 + Math.abs(pctChangeVertexToRecent) / 15);
      reason = `U-shaped recovery confirmed (${minutesSinceVertex}min post-vertex, ${this.formatPercentage(pctChangeVertexToRecent)})`;
      trendStrength = pctChangeVertexToRecent > 8 ? 'STRONG' : pctChangeVertexToRecent > 5 ? 'MODERATE' : 'WEAK';
      
    } else if (!isUShaped && pctChangeVertexToRecent < -1.5) {
      // ∩-shaped decline confirmed
      direction = 'SELL';
      confidence = Math.min(0.95, 0.5 + Math.abs(pctChangeVertexToRecent) / 20);
      reason = `∩-shaped decline confirmed (${minutesSinceVertex}min post-vertex, ${this.formatPercentage(pctChangeVertexToRecent)})`;
      trendStrength = pctChangeVertexToRecent < -8 ? 'STRONG' : pctChangeVertexToRecent < -5 ? 'MODERATE' : 'WEAK';
      
    } else {
      // No actionable signal
      const shapeDesc = isUShaped ? 'U-shaped' : '∩-shaped';
      reason = `${shapeDesc} pattern present but insufficient magnitude (${minutesSinceVertex}min post-vertex, ${this.formatPercentage(pctChangeVertexToRecent)})`;
    }

    // Additional confidence factors
    if (direction === 'BUY' && minutesSinceVertex > this.config.MAX_VERTEX_AGE) {
      return this.createSignal('NONE', 0, `Pattern too aged for BUY (>${this.config.MAX_VERTEX_AGE}min)`, Date.now());
    }

    const signal = this.createSignal(direction, confidence, reason, Date.now(), {
      vertexAge: minutesSinceVertex,
      trendStrength,
      pattern: isUShaped ? 'U_SHAPED' : 'INVERTED_U',
      magnitude: Math.abs(pctChangeVertexToRecent)
    });

    return this.applyStabilityFilter(symbol, signal);
  }

  private createSignal(
    direction: 'BUY' | 'SELL' | 'NONE',
    confidence: number,
    reason: string,
    timestamp: number,
    metadata: Partial<TrendSignal> = {}
  ): TrendSignal {
    const localTimestamp = toLocalTimezone(timestamp);
    
    return {
      direction,
      confidence: Math.round(confidence * 100) / 100,
      firstDetected: localTimestamp,
      lastEvaluated: localTimestamp,
      expiresAt: createExpiryTimestamp(timestamp, this.config.SIGNAL_EXPIRY_MINUTES),
      reason,
      ...metadata
    };
  }

  private applyStabilityFilter(symbol: string, newSignal: TrendSignal): TrendSignal {
    if (!this.signalHistory.has(symbol)) {
      this.signalHistory.set(symbol, []);
    }

    const history = this.signalHistory.get(symbol)!;
    history.push(newSignal);

    // Keep only recent history for stability analysis
    if (history.length > this.config.STABILITY_BUFFER * 2) {
      history.splice(0, history.length - this.config.STABILITY_BUFFER * 2);
    }

    // Require consistent signal for activation
    if (history.length >= this.config.STABILITY_BUFFER) {
      const recentSignals = history.slice(-this.config.STABILITY_BUFFER);
      const allSameDirection = recentSignals.every(s => s.direction === newSignal.direction);
      const avgConfidence = recentSignals.reduce((sum, s) => sum + s.confidence, 0) / recentSignals.length;

      if (allSameDirection && newSignal.direction !== 'NONE') {
        return {
          ...newSignal,
          confidence: avgConfidence,
          reason: `${newSignal.reason} (${this.config.STABILITY_BUFFER}x confirmed)`,
          stable: true
        };
      }
    }

    // Return signal with reduced confidence if not stable
    return {
      ...newSignal,
      confidence: newSignal.confidence * 0.8,
      reason: `${newSignal.reason} (awaiting confirmation)`,
      stable: false
    };
  }

  private calculateWeights(length: number, alpha: number): number[] {
    if (this.config.WEIGHTED_POLYNOMIAL) {
      // Exponential weighting favoring recent data
      return Array.from({ length }, (_, i) => Math.exp(alpha * i / length));
    } else {
      // Equal weighting - all data points have same influence
      return Array.from({ length }, () => 1.0);
    }
  }

  private weightedQuadraticFit(x: number[], y: number[], weights: number[]): number[] {
    // Weighted least squares for quadratic: y = ax² + bx + c
    const W = weights.map(w => Math.sqrt(w));
    
    // Build weighted design matrix
    const X = x.map((xi, i) => [W[i] * xi * xi, W[i] * xi, W[i]]);
    const Y = y.map((yi, i) => W[i] * yi);
    
    // Solve normal equations: (X'X)β = X'Y
    const XT = this.transpose(X);
    const XTX = this.multiply(XT, X);
    const XTY = this.multiplyVec(XT, Y);
    
    return this.solveLinearSystem(XTX, XTY);
  }

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

  private formatPercentage(pct: number): string {
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
  }
}