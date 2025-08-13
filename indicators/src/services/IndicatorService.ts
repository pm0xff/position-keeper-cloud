// src/services/IndicatorService.ts
import { UpdateResult, TokenConfig } from '../types/shared';
import { DatabaseService } from './DatabaseService';
import { SignalGenerator } from './SignalGenerator';
import { TokenManager } from './TokenManager';
import axios from 'axios';

export class IndicatorService {
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

    // Get current price data
    const priceData = await this.fetchPriceData(pair);
    
    // Store price data in database (but don't fail if database is down)
    try {
      await this.databaseService.savePriceData({
        symbol,
        price: priceData.price,
        volume: priceData.volume,
        marketCap: priceData.marketCap,
        timestamp: new Date()
      });
    } catch (error) {
      console.warn(`⚠️  Failed to save price data for ${symbol} to database:`, error);
    }

    // Get historical prices for signal generation
    const prices = await this.databaseService.getRecentPrices(symbol, 360); // Last 6 hours
    
    if (prices.length >= 60) { // Need at least 1 hour of data for basic signals
      // Generate signal
      const signal = this.signalGenerator.generateSignal(token.symbol, prices);
      
      // Update signal count with type assertion to ensure direction is valid
      const direction = signal.direction as keyof typeof result.signals;
      if (direction in result.signals) {
        result.signals[direction]++;
      }

      // Update token with new signal
      await this.tokenManager.updateToken(symbol, { signal });

      console.log(`✅ ${symbol}: Price=${priceData.price.toFixed(8)}, Signal=${signal.direction} (${(signal.confidence * 100).toFixed(0)}%) [${prices.length} data points]`);
    } else {
      // Not enough data for signal generation yet - this is normal for new deployments
      result.signals.NONE++;
      console.log(`⏳ ${symbol}: Price=${priceData.price.toFixed(8)}, Building history (${prices.length}/60 data points needed for signals)`);
    }
  }

  private async fetchPriceData(pairAddress: string): Promise<{
    price: number;
    volume: number;
    marketCap: number;
    quoteToken: string;
  }> {
    const url = `https://api.dexscreener.com/latest/dex/pairs/solana/${pairAddress}`;
    
    try {
      const response = await axios.get(url, { timeout: 10000 });
      const pairData = response.data?.pair;

      if (!pairData) {
        throw new Error('No pair data returned from DexScreener');
      }

      return {
        price: parseFloat(pairData.priceNative || '0'),
        volume: parseFloat(pairData.volume?.h24?.toString() || '0'),
        marketCap: parseFloat(pairData.marketCap?.toString() || pairData.fdv?.toString() || '0'),
        quoteToken: pairData.quoteToken?.symbol || 'SOL'
      };

    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`DexScreener API error: ${error.message}`);
      }
      throw error;
    }
  }

  // Calculate technical indicators
  private calculateRSI(prices: number[], period: number = 14): number {
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

  private calculateEMA(prices: number[], period: number = 20): number {
    if (prices.length === 0) return 0;
    if (prices.length === 1) return prices[0];

    const k = 2 / (period + 1);
    return prices.reduce((ema, price, i) => (i === 0 ? price : price * k + ema * (1 - k)));
  }
}