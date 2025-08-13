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

    // Get current price data with retries and fallbacks
    const priceData = await this.fetchPriceDataWithFallbacks(symbol, pair);
    
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
      console.log(`[DexScreener] Fetching: ${url}`);
      
      const response = await axios.get(url, { 
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        }
      });
      
      console.log(`[DexScreener] Response status: ${response.status}`);
      
      // Enhanced response validation
      if (!response.data) {
        throw new Error(`Empty response from DexScreener for pair ${pairAddress}`);
      }

      const pairData = response.data?.pair;

      if (!pairData) {
        // Log the response structure for debugging
        console.error(`[DexScreener] No pair data in response for ${pairAddress}. Response structure:`, {
          hasData: !!response.data,
          hasSchema: !!response.data?.schemaVersion,
          hasPairs: !!response.data?.pairs,
          hasPair: !!response.data?.pair,
          keys: response.data ? Object.keys(response.data) : []
        });

        // Check if there are pairs in the array format
        if (response.data?.pairs && Array.isArray(response.data.pairs) && response.data.pairs.length > 0) {
          console.log(`[DexScreener] Found pair data in pairs array, using first pair`);
          const firstPair = response.data.pairs[0];
          return this.parsePairData(firstPair);
        }

        throw new Error(`No pair data returned from DexScreener for pair ${pairAddress}`);
      }

      return this.parsePairData(pairData);

    } catch (error) {
      if (axios.isAxiosError(error)) {
        const errorDetails = {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          url: url
        };
        
        console.error(`[DexScreener] Axios error for ${pairAddress}:`, errorDetails);
        
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
      
      console.error(`[DexScreener] General error for ${pairAddress}:`, error);
      throw error;
    }
  }

  private parsePairData(pairData: any): {
    price: number;
    volume: number;
    marketCap: number;
    quoteToken: string;
  } {
    // Enhanced data parsing with better error handling
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

    console.log(`[DexScreener] Parsed result:`, {
      price: result.price,
      volume: result.volume,
      marketCap: result.marketCap,
      quoteToken: result.quoteToken
    });

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

  // Calculate technical indicators (unchanged)
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