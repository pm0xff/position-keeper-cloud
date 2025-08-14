// src/services/TokenManager.ts
import { TokenConfig } from '../types/shared';
import { DatabaseService } from './DatabaseService';

export class TokenManager {
  constructor(private databaseService: DatabaseService) {}

  async loadTokens(): Promise<TokenConfig[]> {
    try {
      const tokens = await this.databaseService.getTokens();
      console.log(`📋 Loaded ${tokens.length} tokens from database`);
      return tokens;
    } catch (error) {
      console.error('Failed to load tokens:', error);
      throw error; // Re-throw for initialization to catch
    }
  }

  async getActiveTokens(): Promise<TokenConfig[]> {
    try {
      const allTokens = await this.loadTokens();
      return allTokens.filter(token => token.active);
    } catch (error) {
      console.error('Failed to get active tokens:', error);
      return [];
    }
  }

  async getAllTokens(): Promise<TokenConfig[]> {
    try {
      return await this.databaseService.getTokens();
    } catch (error) {
      console.error('Failed to get all tokens:', error);
      return [];
    }
  }

  async getToken(symbol: string): Promise<TokenConfig | null> {
    try {
      const tokens = await this.databaseService.getTokens();
      return tokens.find(token => token.symbol === symbol) || null;
    } catch (error) {
      console.error(`Failed to get token ${symbol}:`, error);
      return null;
    }
  }

  async addToken(token: TokenConfig): Promise<void> {
    try {
      await this.databaseService.saveToken(token);
      console.log(`✅ Added token: ${token.symbol}`);
    } catch (error) {
      console.error(`Failed to add token ${token.symbol}:`, error);
      throw error;
    }
  }

  async updateToken(symbol: string, updates: Partial<TokenConfig>): Promise<void> {
    try {
      const existingToken = await this.getToken(symbol);
      if (!existingToken) {
        throw new Error(`Token ${symbol} not found`);
      }

      const updatedToken: TokenConfig = {
        ...existingToken,
        ...updates
      };

      await this.databaseService.saveToken(updatedToken);
      console.log(`✅ Updated token: ${symbol}`);
    } catch (error) {
      console.error(`Failed to update token ${symbol}:`, error);
      throw error;
    }
  }

  async removeToken(symbol: string): Promise<void> {
    try {
      await this.databaseService.deleteToken(symbol);
      console.log(`✅ Removed token: ${symbol}`);
    } catch (error) {
      console.error(`Failed to remove token ${symbol}:`, error);
      throw error;
    }
  }

  async toggleToken(symbol: string): Promise<void> {
    try {
      const token = await this.getToken(symbol);
      if (!token) {
        throw new Error(`Token ${symbol} not found`);
      }

      await this.updateToken(symbol, { active: !token.active });
      console.log(`✅ ${symbol} is now ${!token.active ? 'ACTIVE' : 'INACTIVE'}`);
    } catch (error) {
      console.error(`Failed to toggle token ${symbol}:`, error);
      throw error;
    }
  }

  async validateTokens(): Promise<{
    valid: TokenConfig[];
    invalid: { token: TokenConfig; reason: string }[];
  }> {
    const allTokens = await this.getAllTokens();
    const valid: TokenConfig[] = [];
    const invalid: { token: TokenConfig; reason: string }[] = [];

    for (const token of allTokens) {
      const validationResult = this.validateToken(token);
      if (validationResult.isValid) {
        valid.push(token);
      } else {
        invalid.push({
          token,
          reason: validationResult.reason || 'Unknown validation error'
        });
      }
    }

    return { valid, invalid };
  }

  private validateToken(token: TokenConfig): { isValid: boolean; reason?: string } {
    // Basic validation
    if (!token.symbol || token.symbol.length < 1) {
      return { isValid: false, reason: 'Missing or invalid symbol' };
    }

    if (!token.mint || token.mint.length < 40) {
      return { isValid: false, reason: 'Missing or invalid mint address' };
    }

    if (!token.pair || token.pair.length < 40) {
      return { isValid: false, reason: 'Missing or invalid pair address' };
    }

    // Check for reasonable symbol format (alphanumeric, 2-10 characters)
    if (!/^[A-Z0-9]{2,10}$/i.test(token.symbol)) {
      return { isValid: false, reason: 'Symbol format invalid (should be 2-10 alphanumeric characters)' };
    }

    return { isValid: true };
  }

  async getTokenStatistics(): Promise<{
    total: number;
    active: number;
    inactive: number;
    withSignals: number;
    withRouting: number;
  }> {
    try {
      const allTokens = await this.getAllTokens();
      
      return {
        total: allTokens.length,
        active: allTokens.filter(t => t.active).length,
        inactive: allTokens.filter(t => !t.active).length,
        withSignals: allTokens.filter(t => t.signal).length,
        withRouting: allTokens.filter(t => t.metadata?.routing).length
      };
    } catch (error) {
      console.error('Failed to get token statistics:', error);
      return {
        total: 0,
        active: 0,
        inactive: 0,
        withSignals: 0,
        withRouting: 0
      };
    }
  }

  // Utility method to export tokens in old format for backwards compatibility
  async exportToOldFormat(): Promise<string> {
    try {
      const activeTokens = await this.getActiveTokens();
      return activeTokens
        .map(token => `${token.symbol}:${token.pair}:${token.mint}`)
        .join(',');
    } catch (error) {
      console.error('Failed to export tokens to old format:', error);
      return '';
    }
  }

  // Utility method to import tokens from old format
  async importFromOldFormat(tokensString: string): Promise<{
    imported: number;
    failed: { entry: string; reason: string }[];
  }> {
    const entries = tokensString.split(',').filter(entry => entry.trim());
    const failed: { entry: string; reason: string }[] = [];
    let imported = 0;

    for (const entry of entries) {
      try {
        const parts = entry.trim().split(':');
        if (parts.length !== 3) {
          failed.push({ entry, reason: 'Invalid format (expected SYMBOL:PAIR:MINT)' });
          continue;
        }

        const [symbol, pair, mint] = parts;
        
        const token: TokenConfig = {
          symbol: symbol.toUpperCase(),
          pair,
          mint,
          active: true,
          notes: 'Imported from old format'
        };

        // Check if token already exists
        const existing = await this.getToken(symbol);
        if (existing) {
          failed.push({ entry, reason: `Token ${symbol} already exists` });
          continue;
        }

        await this.addToken(token);
        imported++;

      } catch (error) {
        failed.push({ 
          entry, 
          reason: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    }

    return { imported, failed };
  }
}