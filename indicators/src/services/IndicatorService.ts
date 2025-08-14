// src/services/IndicatorService.ts
import { UpdateResult, TokenConfig } from '../types/shared';
import { DatabaseService } from './DatabaseService';
import { SignalGenerator } from './SignalGenerator';
import { TokenManager } from './TokenManager';
import axios from 'axios';

// ============================================================================
// TECHNICAL INDICATORS MODULE (Modular design for future extensions)
// ============================================================================
class TechnicalIndicators {
  static calculateRSI(prices: number[], period: number = 14): number {
    if (prices.length < period + 1) return 50;

    const deltas = prices.slice(1).map((v, i) => v - prices[i]);
    const gains = deltas.map(d => (d > 0 ? d : 0));
    const losses = deltas.map(d => (d < 0 ? -d : 0));
    
    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  static calculateEMA(prices: number[], period: number = 20): number {
    if (prices.length === 0) return 0;
    if (prices.length === 1) return prices[0];

    const k = 2 / (period + 1);
    return prices.reduce((ema, price, i) => (i === 0 ? price : price * k + ema * (1 - k)));
  }

  static calculateTrendMetrics(rawPrices: number[]): {
    hourlyChangePct: number;
    drawdownFromPeak: number;
    volatilityPct: number;
    emaTrend: 'up' | 'down' | 'flat';
    trendScore: number;
  } {
    if (rawPrices.length < 60) {
      return {
        hourlyChangePct: 0,
        drawdownFromPeak: 0,
        volatilityPct: 0,
        emaTrend: 'flat',
        trendScore: 0
      };
    }

    const recent = rawPrices.slice(-60); // Last hour of data
    const first = recent[0];
    const last = recent[recent.length - 1];
    const peak = Math.max(...recent);
    const trough = Math.min(...recent);
    
    // EMA trend calculation
    const ema = this.calculateEMA(recent, 20);
    const emaPrev = this.calculateEMA(recent.slice(0, -1), 20);
    const delta = ema - emaPrev;
    
    let emaTrend: 'up' | 'down' | 'flat';
    if (delta > 0.00001) emaTrend = 'up';
    else if (delta < -0.00001) emaTrend = 'down';
    else emaTrend = 'flat';

    // Calculate metrics
    const hourlyChangePct = ((last - first) / first) * 100;
    const drawdownFromPeak = ((peak - last) / peak) * 100;
    const volatilityPct = ((peak - trough) / trough) * 100;

    // Trend score calculation (0-100)
    let trendScore = 0;
    if (hourlyChangePct > 0) trendScore += 30;
    if (drawdownFromPeak < 10) trendScore += 30;
    if (volatilityPct > 5) trendScore += 20;
    if (emaTrend === 'up') trendScore += 20;

    return {
      hourlyChangePct,
      drawdownFromPeak,
      volatilityPct,
      emaTrend,
      trendScore
    };
  }
}

// ============================================================================
// PATTERN ANALYZER MODULE (Advanced signal generation)
// ============================================================================
class PatternAnalyzer {
  private static readonly SIGNAL_CONFIG = {
    MIN_VERTEX_AGE: 20,      // minutes
    MAX_VERTEX_AGE: 120,     // minutes
    SIGNAL_EXPIRY_MINUTES: 15,
    MIN_MAGNITUDE: 1.5       // percentage
  };

  // Matrix operations for quadratic fitting
  private static transpose(A: number[][]): number[][] {
    return A[0].map((_, i) => A.map(row => row[i]));
  }

  private static multiply(A: number[][], B: number[][]): number[][] {
    return A.map(row =>
      B[0].map((_, j) => row.reduce((sum, val, k) => sum + val * B[k][j], 0))
    );
  }

  private static multiplyVec(A: number[][], v: number[]): number[] {
    return A.map(row => row.reduce((sum, val, i) => sum + val * v[i], 0));
  }

  private static solveLinearSystem(A: number[][], b: number[]): number[] {
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

  private static quadraticFit(x: number[], y: number[]): number[] {
    // Least squares for quadratic: y = ax² + bx + c
    const X = x.map(xi => [xi * xi, xi, 1]);
    const XT = this.transpose(X);
    const XTX = this.multiply(XT, X);
    const XTY = this.multiplyVec(XT, y);
    
    return this.solveLinearSystem(XTX, XTY);
  }

  static analyzePattern(prices: number[], lastUpdated: number): {
    direction: 'BUY' | 'SELL' | 'NONE';
    confidence: number;
    reason: string;
    vertexAge?: number;
    trendStrength?: 'STRONG' | 'MODERATE' | 'WEAK';
    pattern?: 'U_SHAPED' | 'INVERTED_U';
    magnitude?: number;
    expiresAt: number;
  } {
    if (prices.length < 360) {
      return {
        direction: 'NONE',
        confidence: 0,
        reason: `Insufficient data (${prices.length}/360 points)`,
        expiresAt: Date.now() + (this.SIGNAL_CONFIG.SIGNAL_EXPIRY_MINUTES * 60 * 1000)
      };
    }

    // Use last 360 minutes (6 hours) for pattern analysis
    const y = prices.slice(-360);
    const x = y.map((_, i) => i);
    const end = y[y.length - 1];

    try {
      // Quadratic fitting to detect U-shaped or ∩-shaped patterns
      const [a, b, c] = this.quadraticFit(x, y);
      
      const vertexX = -b / (2 * a);
      const vertexIdx = Math.max(0, Math.min(359, Math.round(vertexX)));
      const vertexPrice = y[vertexIdx];

      // Calculate vertex age in minutes
      const minutesSinceVertex = 360 - vertexIdx;

      // Calculate price change from vertex to current
      const pctChangeVertexToRecent = ((end - vertexPrice) / vertexPrice) * 100;
      const isUShaped = a > 0;
      const isInvertedUShaped = a < 0;

      // Validate vertex age
      if (minutesSinceVertex < this.SIGNAL_CONFIG.MIN_VERTEX_AGE) {
        return {
          direction: 'NONE',
          confidence: 0.1,
          reason: `Vertex too recent (${minutesSinceVertex}min < ${this.SIGNAL_CONFIG.MIN_VERTEX_AGE}min)`,
          expiresAt: Date.now() + (this.SIGNAL_CONFIG.SIGNAL_EXPIRY_MINUTES * 60 * 1000)
        };
      }

      let direction: 'BUY' | 'SELL' | 'NONE' = 'NONE';
      let confidence = 0;
      let reason = '';
      let trendStrength: 'STRONG' | 'MODERATE' | 'WEAK' = 'WEAK';

      if (isUShaped && pctChangeVertexToRecent > this.SIGNAL_CONFIG.MIN_MAGNITUDE) {
        // U-shaped recovery confirmed
        direction = 'BUY';
        confidence = Math.min(0.95, 0.5 + Math.abs(pctChangeVertexToRecent) / 15);
        reason = `U-shaped recovery confirmed (${minutesSinceVertex}min post-vertex, ${pctChangeVertexToRecent.toFixed(2)}%)`;
        trendStrength = pctChangeVertexToRecent > 8 ? 'STRONG' : pctChangeVertexToRecent > 5 ? 'MODERATE' : 'WEAK';
        
      } else if (isInvertedUShaped && pctChangeVertexToRecent < -this.SIGNAL_CONFIG.MIN_MAGNITUDE) {
        // ∩-shaped decline confirmed
        direction = 'SELL';
        confidence = Math.min(0.95, 0.5 + Math.abs(pctChangeVertexToRecent) / 20);
        reason = `∩-shaped decline confirmed (${minutesSinceVertex}min post-vertex, ${pctChangeVertexToRecent.toFixed(2)}%)`;
        trendStrength = pctChangeVertexToRecent < -8 ? 'STRONG' : pctChangeVertexToRecent < -5 ? 'MODERATE' : 'WEAK';
        
      } else {
        // Pattern detected but insufficient magnitude
        const shapeDesc = isUShaped ? 'U-shaped' : '∩-shaped';
        reason = `${shapeDesc} pattern present but insufficient magnitude (${minutesSinceVertex}min post-vertex, ${pctChangeVertexToRecent.toFixed(2)}%)`;
      }

      // Check for aged patterns
      if (direction === 'BUY' && minutesSinceVertex > this.SIGNAL_CONFIG.MAX_VERTEX_AGE) {
        return {
          direction: 'NONE',
          confidence: 0,
          reason: `Pattern too aged for BUY (>${this.SIGNAL_CONFIG.MAX_VERTEX_AGE}min)`,
          expiresAt: Date.now() + (this.SIGNAL_CONFIG.SIGNAL_EXPIRY_MINUTES * 60 * 1000)
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
        expiresAt: Date.now() + (this.SIGNAL_CONFIG.SIGNAL_EXPIRY_MINUTES * 60 * 1000)
      };

    } catch (error) {
      return {
        direction: 'NONE',
        confidence: 0,
        reason: `Pattern analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        expiresAt: Date.now() + (this.SIGNAL_CONFIG.SIGNAL_EXPIRY_MINUTES * 60 * 1000)
      };
    }
  }
}

// ============================================================================
// ENHANCED INDICATOR SERVICE
// ============================================================================
export class IndicatorService {
  // In-memory price history for calculations (per token)
  private priceHistories = new Map<string, number[]>();

  constructor(
    private databaseService: DatabaseService,
    private signalGenerator: SignalGenerator,
    private tokenManager: TokenManager
  ) {}

  async updateAllTokens(): Promise<UpdateResult> {
    const result: UpdateResult = {
      processed: 0,
      failed: 0,
      signals: {
        BUY: 0,
        SELL: 0,
        NONE: 0
      },
      errors: []
    };

    try {
      const activeTokens = await this.tokenManager.getActiveTokens();
      
      if (activeTokens.length === 0) {
        result.errors.push('No active tokens configured');
        return result;
      }

      console.log(`📊 Processing ${activeTokens.length} active tokens...`);

      // Process each token
      for (const token of activeTokens) {
        try {
          await this.updateSingleToken(token, result);
          result.processed++;
        } catch (error) {
          result.failed++;
          const errorMsg = `${token.symbol}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          result.errors.push(errorMsg);
          console.error(`❌ Failed to update ${token.symbol}:`, error);
        }
      }

      return result;

    } catch (error) {
      result.errors.push(`Global update failure: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return result;
    }
  }

  private async updateSingleToken(token: TokenConfig, result: UpdateResult): Promise<void> {
    const { symbol, pair, mint } = token;

    // Get current price data with fallbacks
    const priceData = await this.fetchPriceDataWithFallbacks(symbol, pair);
    
    // Update in-memory price history for calculations
    this.updatePriceHistory(symbol, priceData.price);
    const priceHistory = this.priceHistories.get(symbol) || [];

    // Calculate all technical indicators
    const indicators = this.calculateAllIndicators(symbol, priceData, priceHistory);
    
    // Store comprehensive indicator data in database
    try {
      await this.databaseService.saveFullIndicators({
        symbol,
        price: priceData.price,
        native_price: priceData.price, // Assuming same for now
        native_currency: priceData.quoteToken,
        trading_currency: priceData.quoteToken,
        currency_mismatch: 0,
        
        // Technical indicators
        rsi_1m: indicators.rsi_1m,
        rsi_5m: indicators.rsi_5m,
        rsi_15m: indicators.rsi_15m,
        ema_1m: indicators.ema_1m,
        ema_5m: indicators.ema_5m,
        ema_15m: indicators.ema_15m,
        ema_trend: indicators.ema_trend,
        
        // Market data
        volume_24h: priceData.volume,
        market_cap: priceData.marketCap,
        volume_to_cap_ratio: priceData.marketCap > 0 ? priceData.volume / priceData.marketCap : 0,
        
        // Trend metrics
        trend_score: indicators.trend_score,
        hourly_change_pct: indicators.hourly_change_pct,
        drawdown_from_peak: indicators.drawdown_from_peak,
        volatility_pct: indicators.volatility_pct,
        
        // Metadata
        decimals: 6, // Default, could be queried from mint
        analysis_mode: priceData.quoteToken,
        timestamp: new Date()
      });
    } catch (error) {
      console.warn(`⚠️  Failed to save indicator data for ${symbol} to database:`, error);
    }

    // Generate advanced signals if we have enough data
    if (priceHistory.length >= 60) { // Need at least 1 hour for basic signals
      const signal = PatternAnalyzer.analyzePattern(priceHistory, Date.now());
      
      // Store signal in database
      try {
        await this.databaseService.saveSignal({
          symbol,
          direction: signal.direction,
          confidence: signal.confidence,
          reason: signal.reason,
          vertex_age: signal.vertexAge,
          trend_strength: signal.trendStrength,
          pattern: signal.pattern,
          magnitude: signal.magnitude,
          stable: 0, // Could implement stability tracking later
          first_detected: Math.floor(Date.now() / 1000),
          last_evaluated: Math.floor(Date.now() / 1000),
          expires_at: Math.floor(signal.expiresAt / 1000)
        });
      } catch (error) {
        console.warn(`⚠️  Failed to save signal for ${symbol} to database:`, error);
      }

      // Update result counts
      const direction = signal.direction as keyof typeof result.signals;
      if (direction in result.signals) {
        result.signals[direction]++;
      }

      console.log(`✅ ${symbol}: Price=${priceData.price.toFixed(8)}, RSI=${indicators.rsi_1m.toFixed(1)}, Signal=${signal.direction} (${(signal.confidence * 100).toFixed(0)}%) [${priceHistory.length} data points]`);
    } else {
      // Not enough data yet
      result.signals.NONE++;
      console.log(`⏳ ${symbol}: Price=${priceData.price.toFixed(8)}, Building history (${priceHistory.length}/60 data points needed)`);
    }
  }

  private updatePriceHistory(symbol: string, price: number): void {
    if (!this.priceHistories.has(symbol)) {
      this.priceHistories.set(symbol, []);
    }

    const history = this.priceHistories.get(symbol)!;
    history.push(price);

    // Keep last 24 hours (1440 minutes) of data
    if (history.length > 1440) {
      history.shift();
    }
  }

  private calculateAllIndicators(symbol: string, priceData: any, priceHistory: number[]): any {
    // Multi-timeframe indicator calculation
const indicators: {
      rsi_1m: number;
      rsi_5m: number;
      rsi_15m: number;
      ema_1m: number;
      ema_5m: number;
      ema_15m: number;
      ema_trend: 'up' | 'down' | 'flat';
      trend_score: number;
      hourly_change_pct: number;
      drawdown_from_peak: number;
      volatility_pct: number;
    } = {
      rsi_1m: 50,
      rsi_5m: 50,
      rsi_15m: 50,
      ema_1m: priceData.price,
      ema_5m: priceData.price,
      ema_15m: priceData.price,
      ema_trend: 'flat',
      trend_score: 0,
      hourly_change_pct: 0,
      drawdown_from_peak: 0,
      volatility_pct: 0
    };

    if (priceHistory.length >= 15) {
      // 1-minute timeframe (last 14 points)
      indicators.rsi_1m = TechnicalIndicators.calculateRSI(priceHistory.slice(-15), 14);
      indicators.ema_1m = TechnicalIndicators.calculateEMA(priceHistory.slice(-20), 20);
    }

    if (priceHistory.length >= 75) {
      // 5-minute timeframe (every 5th point for last ~14 periods)
      const fiveMinPrices = priceHistory.filter((_, i) => i % 5 === 0).slice(-15);
      indicators.rsi_5m = TechnicalIndicators.calculateRSI(fiveMinPrices, 14);
      indicators.ema_5m = TechnicalIndicators.calculateEMA(fiveMinPrices.slice(-20), 20);
    }

    if (priceHistory.length >= 225) {
      // 15-minute timeframe (every 15th point for last ~14 periods)
      const fifteenMinPrices = priceHistory.filter((_, i) => i % 15 === 0).slice(-15);
      indicators.rsi_15m = TechnicalIndicators.calculateRSI(fifteenMinPrices, 14);
      indicators.ema_15m = TechnicalIndicators.calculateEMA(fifteenMinPrices.slice(-20), 20);
    }

    // Trend metrics (requires at least 1 hour of data)
    if (priceHistory.length >= 60) {
      const trendMetrics = TechnicalIndicators.calculateTrendMetrics(priceHistory);
      indicators.ema_trend = trendMetrics.emaTrend;
      indicators.trend_score = trendMetrics.trendScore;
      indicators.hourly_change_pct = trendMetrics.hourlyChangePct;
      indicators.drawdown_from_peak = trendMetrics.drawdownFromPeak;
      indicators.volatility_pct = trendMetrics.volatilityPct;
    }

    return indicators;
  }

  // Enhanced price fetching with fallbacks (from previous version)
  private async fetchPriceDataWithFallbacks(symbol: string, pairAddress: string): Promise<{
    price: number;
    volume: number;
    marketCap: number;
    quoteToken: string;
  }> {
    // Known good pair addresses (updated 2025-08-13)
    const FALLBACK_PAIRS: Record<string, string[]> = {
      'BONK': [
        '6oFWm7KPLfxnwMb3z5xwBoXNSPP3JJyirAPqPSiVcnsp', // Meteora DLMM (current working)
        '3Ne4mwqDyuniyrYzC9tRA3FCfufdeRgHH97VnPbJicr1',  // Orca fallback
      ],
      'WIF': [
        'ep2ib6dydeeqd8mfe2ezhcxx3kp3k2elkkirfpm5eymx', // Raydium (current working)
        'd6ndkrknqpmrzccng1gqxtf7mmohb7qr6gu5tkg59qz1', // Orca fallback
        '6qgydw4fhvptamfnzvpauetebvwrkfvauuhfnzvempky', // Orca fallback 2
      ]
    };

    // Try original pair first, then fallbacks
    const pairsToTry = [pairAddress, ...(FALLBACK_PAIRS[symbol] || [])];
    
    for (let i = 0; i < pairsToTry.length; i++) {
      const currentPair = pairsToTry[i];
      
      try {
        const result = await this.fetchPriceData(currentPair);
        
        // If this is a fallback pair that worked, log it
        if (i > 0) {
          console.log(`🔄 ${symbol}: Using fallback pair ${currentPair} (original ${pairAddress} failed)`);
          
          // Optionally update the database with the working pair
          try {
            await this.tokenManager.updateToken(symbol, { pair: currentPair });
            console.log(`📝 ${symbol}: Updated database with working pair address`);
          } catch (error) {
            console.warn(`⚠️  Failed to update ${symbol} pair in database:`, error);
          }
        }
        
        return result;
        
      } catch (error) {
        console.warn(`⚠️  Pair ${currentPair} failed for ${symbol}:`, error instanceof Error ? error.message : 'Unknown error');
        
        // If this is the last pair to try, throw the error
        if (i === pairsToTry.length - 1) {
          throw new Error(`All pair addresses failed for ${symbol}. Original error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }

    // This should never be reached due to the throw above, but TypeScript requires it
    throw new Error(`No working pair found for ${symbol}`);
  }

  private async fetchPriceData(pairAddress: string): Promise<{
    price: number;
    volume: number;
    marketCap: number;
    quoteToken: string;
  }> {
    const url = `https://api.dexscreener.com/latest/dex/pairs/solana/${pairAddress}`;
    
    try {
      const response = await axios.get(url, { 
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        }
      });
      
      // Enhanced response validation
      if (!response.data) {
        throw new Error(`Empty response from DexScreener for pair ${pairAddress}`);
      }

      const pairData = response.data?.pair;

      if (!pairData) {
        // Check if there are pairs in the array format
        if (response.data?.pairs && Array.isArray(response.data.pairs) && response.data.pairs.length > 0) {
          const firstPair = response.data.pairs[0];
          return this.parsePairData(firstPair);
        }

        throw new Error(`No pair data returned from DexScreener for pair ${pairAddress}`);
      }

      return this.parsePairData(pairData);

    } catch (error) {
      if (axios.isAxiosError(error)) {
        // More specific error messages
        if (error.response?.status === 404) {
          throw new Error(`Pair ${pairAddress} not found on DexScreener (404)`);
        } else if (error.response?.status === 429) {
          throw new Error(`DexScreener rate limit exceeded (429) - retrying later`);
        } else if (error.response?.status >= 500) {
          throw new Error(`DexScreener server error (${error.response.status}) - service may be down`);
        } else {
          throw new Error(`DexScreener API error: ${error.response?.status} - ${JSON.stringify(error.response?.data)}`);
        }
      }
      
      throw error;
    }
  }

  private parsePairData(pairData: any): {
    price: number;
    volume: number;
    marketCap: number;
    quoteToken: string;
  } {
    const result = {
      price: this.parseFloat(pairData?.priceNative, 'priceNative'),
      volume: this.parseFloat(pairData?.volume?.h24?.toString(), 'volume.h24'),
      marketCap: this.parseFloat(pairData?.marketCap?.toString() || pairData?.fdv?.toString(), 'marketCap/fdv'),
      quoteToken: pairData?.quoteToken?.symbol || 'SOL'
    };

    // Validate critical fields
    if (result.price <= 0) {
      throw new Error(`Invalid price data: ${pairData?.priceNative}`);
    }

    return result;
  }

  private parseFloat(value: string | undefined, fieldName: string): number {
    if (!value) {
      console.warn(`[DexScreener] Missing ${fieldName}, using 0`);
      return 0;
    }
    
    const parsed = parseFloat(value);
    if (isNaN(parsed)) {
      console.warn(`[DexScreener] Invalid ${fieldName}: "${value}", using 0`);
      return 0;
    }
    
    return parsed;
  }
}