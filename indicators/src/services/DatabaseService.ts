// src/services/DatabaseService.ts
import { TokenConfig } from '../types/shared';
import axios from 'axios';

interface PriceData {
  symbol: string;
  price: number;
  volume: number;
  marketCap: number;
  timestamp: Date;
}

export class DatabaseService {
  private dbUrl: string;
  private apiToken: string;

  constructor() {
    this.dbUrl = process.env.CLOUDFLARE_D1_DATABASE_URL || '';
    this.apiToken = process.env.CLOUDFLARE_D1_TOKEN || '';
  }

  async initialize(): Promise<void> {
    if (!this.dbUrl || !this.apiToken) {
      throw new Error('Missing Cloudflare D1 database configuration');
    }

    try {
      // Test database connection with a simple query
      await this.executeQuery('SELECT COUNT(*) as count FROM tokens');
      console.log('✅ Database initialized successfully');
    } catch (error) {
      console.error('❌ Database initialization failed:', error);
      throw error;
    }
  }

  private async executeQuery(sql: string, params: any[] = []): Promise<any> {
    try {
      console.log(`[DB] Executing query: ${sql.substring(0, 100)}...`);
      
      const response = await axios.post(
        this.dbUrl, // This should already include /query endpoint
        {
          sql,
          params
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );

      console.log(`[DB] Query response status: ${response.status}`);
      
      if (response.data.success === false) {
        throw new Error(`D1 API Error: ${JSON.stringify(response.data.errors)}`);
      }

      return response.data.result;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(`[DB] Axios error:`, {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          url: this.dbUrl
        });
        throw new Error(`Database query failed: ${error.response?.status} ${error.response?.statusText} - ${JSON.stringify(error.response?.data)}`);
      }
      throw error;
    }
  }

  async getTokens(): Promise<TokenConfig[]> {
    try {
      const result = await this.executeQuery('SELECT * FROM tokens WHERE active = 1');
      
      if (!result || !result[0] || !result[0].results) {
        console.log('[DB] No active tokens found in database');
        return [];
      }

      return result[0].results.map((row: any) => ({
        symbol: row.symbol,
        pair: row.pair,
        mint: row.mint,
        active: Boolean(row.active),
        notes: row.notes || '',
        // Parse JSON fields if they exist
        signal: undefined, // Signals are now in separate table
        metadata: row.routing_info ? JSON.parse(row.routing_info) : undefined
      }));
    } catch (error) {
      console.error('Failed to get tokens:', error);
      return [];
    }
  }

  async saveToken(token: TokenConfig): Promise<void> {
    const sql = `
      INSERT OR REPLACE INTO tokens 
      (symbol, pair, mint, active, routing_info, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    const params = [
      token.symbol,
      token.pair,
      token.mint,
      token.active ? 1 : 0,
      token.metadata ? JSON.stringify(token.metadata) : null,
      token.notes || null
    ];

    await this.executeQuery(sql, params);
  }

  async deleteToken(symbol: string): Promise<void> {
    await this.executeQuery('DELETE FROM tokens WHERE symbol = ?', [symbol]);
  }

  async savePriceData(data: PriceData): Promise<void> {
    // Save to indicators table with current timestamp
    const sql = `
      INSERT INTO indicators (symbol, price, native_price, volume_24h, market_cap, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    const params = [
      data.symbol,
      data.price,
      data.price, // Using same as native for now
      data.volume,
      data.marketCap,
      Math.floor(data.timestamp.getTime() / 1000) // Convert to Unix timestamp
    ];

    await this.executeQuery(sql, params);
  }

  async getRecentPrices(symbol: string, minutes: number): Promise<number[]> {
    try {
      const sql = `
        SELECT price FROM indicators 
        WHERE symbol = ? 
        AND timestamp > (strftime('%s', 'now') - ?)
        ORDER BY timestamp ASC
      `;

      const result = await this.executeQuery(sql, [symbol, minutes * 60]);
      
      if (!result || !result[0] || !result[0].results) {
        return [];
      }

      return result[0].results.map((row: any) => row.price);
    } catch (error) {
      console.error(`Failed to get recent prices for ${symbol}:`, error);
      return [];
    }
  }

  async saveFullIndicators(indicators: {
    symbol: string;
    price: number;
    native_price: number;
    native_currency: string;
    trading_currency: string;
    currency_mismatch: number;
    rsi_1m: number;
    rsi_5m: number;
    rsi_15m: number;
    ema_1m: number;
    ema_5m: number;
    ema_15m: number;
    ema_trend: string;
    volume_24h: number;
    market_cap: number;
    volume_to_cap_ratio: number;
    trend_score: number;
    hourly_change_pct: number;
    drawdown_from_peak: number;
    volatility_pct: number;
    decimals: number;
    analysis_mode: string;
    timestamp: Date;
  }): Promise<void> {
    const sql = `
      INSERT INTO indicators (
        symbol, price, native_price, native_currency, trading_currency, currency_mismatch,
        rsi_1m, rsi_5m, rsi_15m, ema_1m, ema_5m, ema_15m, ema_trend,
        volume_24h, market_cap, volume_to_cap_ratio, trend_score,
        hourly_change_pct, drawdown_from_peak, volatility_pct,
        decimals, analysis_mode, timestamp
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      indicators.symbol,
      indicators.price,
      indicators.native_price,
      indicators.native_currency,
      indicators.trading_currency,
      indicators.currency_mismatch,
      indicators.rsi_1m,
      indicators.rsi_5m,
      indicators.rsi_15m,
      indicators.ema_1m,
      indicators.ema_5m,
      indicators.ema_15m,
      indicators.ema_trend,
      indicators.volume_24h,
      indicators.market_cap,
      indicators.volume_to_cap_ratio,
      indicators.trend_score,
      indicators.hourly_change_pct,
      indicators.drawdown_from_peak,
      indicators.volatility_pct,
      indicators.decimals,
      indicators.analysis_mode,
      Math.floor(indicators.timestamp.getTime() / 1000)
    ];

    await this.executeQuery(sql, params);
  }

  async saveSignal(signal: {
    symbol: string;
    direction: string;
    confidence: number;
    reason: string;
    vertex_age?: number;
    trend_strength?: string;
    pattern?: string;
    magnitude?: number;
    stable: number;
    first_detected: number;
    last_evaluated: number;
    expires_at: number;
  }): Promise<void> {
    const sql = `
      INSERT INTO signals (
        symbol, direction, confidence, reason, vertex_age, trend_strength,
        pattern, magnitude, stable, first_detected, last_evaluated, expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      signal.symbol,
      signal.direction,
      signal.confidence,
      signal.reason,
      signal.vertex_age || null,
      signal.trend_strength || null,
      signal.pattern || null,
      signal.magnitude || null,
      signal.stable,
      signal.first_detected,
      signal.last_evaluated,
      signal.expires_at
    ];

    await this.executeQuery(sql, params);
  }

  async getActiveSignals(symbol?: string): Promise<any[]> {
    try {
      let sql = `
        SELECT * FROM signals 
        WHERE expires_at > strftime('%s', 'now')
      `;
      const params: any[] = [];

      if (symbol) {
        sql += ` AND symbol = ?`;
        params.push(symbol);
      }

      sql += ` ORDER BY confidence DESC, last_evaluated DESC`;

      const result = await this.executeQuery(sql, params);
      
      if (!result || !result[0] || !result[0].results) {
        return [];
      }

      return result[0].results;
    } catch (error) {
      console.error('Failed to get active signals:', error);
      return [];
    }
  }

  async getLatestIndicators(symbol?: string): Promise<any[]> {
    try {
      let sql = `
        SELECT * FROM latest_indicators
      `;
      const params: any[] = [];

      if (symbol) {
        sql += ` WHERE symbol = ?`;
        params.push(symbol);
      }

      sql += ` ORDER BY timestamp DESC`;

      const result = await this.executeQuery(sql, params);
      
      if (!result || !result[0] || !result[0].results) {
        return [];
      }

      return result[0].results;
    } catch (error) {
      console.error('Failed to get latest indicators:', error);
      return [];
    }
  }

  async getTokenStatistics(): Promise<{
    totalTokens: number;
    activeTokens: number;
    totalIndicators: number;
    activeSignals: number;
    latestUpdate: number | null;
  }> {
    try {
      const [tokensResult, indicatorsResult, signalsResult, latestResult] = await Promise.all([
        this.executeQuery(`SELECT COUNT(*) as total, SUM(active) as active FROM tokens`),
        this.executeQuery(`SELECT COUNT(*) as total FROM indicators`),
        this.executeQuery(`SELECT COUNT(*) as active FROM signals WHERE expires_at > strftime('%s', 'now') AND direction != 'NONE'`),
        this.executeQuery(`SELECT MAX(timestamp) as latest FROM indicators`)
      ]);

      return {
        totalTokens: tokensResult[0]?.results?.[0]?.total || 0,
        activeTokens: tokensResult[0]?.results?.[0]?.active || 0,
        totalIndicators: indicatorsResult[0]?.results?.[0]?.total || 0,
        activeSignals: signalsResult[0]?.results?.[0]?.active || 0,
        latestUpdate: latestResult[0]?.results?.[0]?.latest || null
      };
    } catch (error) {
      console.error('Failed to get system health:', error);
      throw error;
    }
  }

  async cleanupOldIndicators(daysToKeep: number = 30): Promise<void> {
    const cutoffTime = Math.floor(Date.now() / 1000) - (daysToKeep * 24 * 60 * 60);
    
    const sql = `DELETE FROM indicators WHERE timestamp < ?`;
    
    try {
      await this.executeQuery(sql, [cutoffTime]);
      console.log(`🧹 Cleaned up old indicators (kept last ${daysToKeep} days)`);
    } catch (error) {
      console.error(`Failed to cleanup old indicators:`, error);
    }
  }

  async cleanupExpiredSignals(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const sql = `DELETE FROM signals WHERE expires_at < ?`;
    
    try {
      await this.executeQuery(sql, [now]);
      console.log(`🧹 Cleaned up expired signals`);
    } catch (error) {
      console.error(`Failed to cleanup expired signals:`, error);
    }
  }

  async getIndicatorHistory(symbol: string, hours: number = 24): Promise<any[]> {
    try {
      const startTime = Math.floor(Date.now() / 1000) - (hours * 60 * 60);
      
      const sql = `
        SELECT * FROM indicators 
        WHERE symbol = ? AND timestamp >= ?
        ORDER BY timestamp ASC
      `;

      const result = await this.executeQuery(sql, [symbol, startTime]);
      
      if (!result || !result[0] || !result[0].results) {
        return [];
      }

      return result[0].results;
    } catch (error) {
      console.error(`Failed to get indicator history for ${symbol}:`, error);
      return [];
    }
  }

  async getSignalHistory(symbol: string, hours: number = 24): Promise<any[]> {
    try {
      const startTime = Math.floor(Date.now() / 1000) - (hours * 60 * 60);
      
      const sql = `
        SELECT * FROM signals 
        WHERE symbol = ? AND last_evaluated >= ?
        ORDER BY last_evaluated DESC
      `;

      const result = await this.executeQuery(sql, [symbol, startTime]);
      
      if (!result || !result[0] || !result[0].results) {
        return [];
      }

      return result[0].results;
    } catch (error) {
      console.error(`Failed to get signal history for ${symbol}:`, error);
      return [];
    }
  }

  async bulkSaveIndicators(indicatorsList: any[]): Promise<{
    saved: number;
    failed: number;
    errors: string[];
  }> {
    const result = {
      saved: 0,
      failed: 0,
      errors: []
    };

    for (const indicators of indicatorsList) {
      try {
        await this.saveFullIndicators(indicators);
        result.saved++;
      } catch (error) {
        result.failed++;
        result.errors.push(`${indicators.symbol}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return result;
  }

  async bulkSaveSignals(signalsList: any[]): Promise<{
    saved: number;
    failed: number;
    errors: string[];
  }> {
    const result = {
      saved: 0,
      failed: 0,
      errors: []
    };

    for (const signal of signalsList) {
      try {
        await this.saveSignal(signal);
        result.saved++;
      } catch (error) {
        result.failed++;
        result.errors.push(`${signal.symbol}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return result;
  }

  async close(): Promise<void> {
    // Cloudflare D1 is HTTP-based, no persistent connections to close
    console.log('✅ Database service closed');
  }
}