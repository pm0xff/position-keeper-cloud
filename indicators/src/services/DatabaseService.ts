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
      // Test database connection by creating tables if they don't exist
      await this.createTablesIfNotExists();
      console.log('✅ Database initialized successfully');
    } catch (error) {
      console.error('❌ Database initialization failed:', error);
      throw error;
    }
  }

  private async createTablesIfNotExists(): Promise<void> {
    const createTokensTable = `
      CREATE TABLE IF NOT EXISTS tokens (
        symbol TEXT PRIMARY KEY,
        pair TEXT NOT NULL,
        mint TEXT NOT NULL,
        active BOOLEAN DEFAULT true,
        notes TEXT,
        signal_data TEXT,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createPricesTable = `
      CREATE TABLE IF NOT EXISTS prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        price REAL NOT NULL,
        volume REAL,
        market_cap REAL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (symbol) REFERENCES tokens (symbol)
      )
    `;

    await this.executeQuery(createTokensTable);
    await this.executeQuery(createPricesTable);
  }

  private async executeQuery(sql: string, params: any[] = []): Promise<any> {
    try {
      const response = await axios.post(
        `${this.dbUrl}/query`,
        {
          sql,
          params
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Database query failed: ${error.message}`);
      }
      throw error;
    }
  }

  async getTokens(): Promise<TokenConfig[]> {
    try {
      const result = await this.executeQuery('SELECT * FROM tokens');
      
      if (!result.results || result.results.length === 0) {
        return [];
      }

      return result.results.map((row: any) => ({
        symbol: row.symbol,
        pair: row.pair,
        mint: row.mint,
        active: Boolean(row.active),
        notes: row.notes || '',
        signal: row.signal_data ? JSON.parse(row.signal_data) : undefined,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined
      }));
    } catch (error) {
      console.error('Failed to get tokens:', error);
      return [];
    }
  }

  async saveToken(token: TokenConfig): Promise<void> {
    const sql = `
      INSERT OR REPLACE INTO tokens 
      (symbol, pair, mint, active, notes, signal_data, metadata, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `;

    const params = [
      token.symbol,
      token.pair,
      token.mint,
      token.active,
      token.notes || null,
      token.signal ? JSON.stringify(token.signal) : null,
      token.metadata ? JSON.stringify(token.metadata) : null
    ];

    await this.executeQuery(sql, params);
  }

  async deleteToken(symbol: string): Promise<void> {
    await this.executeQuery('DELETE FROM tokens WHERE symbol = ?', [symbol]);
  }

  async savePriceData(data: PriceData): Promise<void> {
    const sql = `
      INSERT INTO prices (symbol, price, volume, market_cap, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `;

    const params = [
      data.symbol,
      data.price,
      data.volume,
      data.marketCap,
      data.timestamp.toISOString()
    ];

    await this.executeQuery(sql, params);
  }

  async getRecentPrices(symbol: string, minutes: number): Promise<number[]> {
    try {
      const sql = `
        SELECT price FROM prices 
        WHERE symbol = ? 
        AND timestamp > datetime('now', '-${minutes} minutes')
        ORDER BY timestamp ASC
      `;

      const result = await this.executeQuery(sql, [symbol]);
      
      if (!result.results) {
        return [];
      }

      return result.results.map((row: any) => row.price);
    } catch (error) {
      console.error(`Failed to get recent prices for ${symbol}:`, error);
      return [];
    }
  }

  async close(): Promise<void> {
    // Cloudflare D1 is HTTP-based, no persistent connections to close
    console.log('✅ Database service closed');
  }
}