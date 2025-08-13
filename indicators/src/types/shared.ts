// src/types/shared.ts - Local shared types and utilities

export interface TrendSignal {
  direction: 'BUY' | 'SELL' | 'NONE';
  confidence: number;
  firstDetected: string;
  lastEvaluated: string;
  expiresAt: string;
  reason: string;
  vertexAge?: number;
  trendStrength?: 'STRONG' | 'MODERATE' | 'WEAK';
  stable?: boolean;
  pattern?: 'U_SHAPED' | 'INVERTED_U';
  magnitude?: number;
}

export interface TokenConfig {
  symbol: string;
  pair: string;
  mint: string;
  active: boolean;
  notes?: string;
  signal?: TrendSignal;
  metadata?: {
    routing?: {
      tradingCurrency: string;
      nativeCurrency: string;
      isDirect: boolean;
      currencyMismatch: boolean;
      lastChecked: string;
    };
  };
}

export interface ConfigFile {
  tokens: TokenConfig[];
  config: {
    version: string;
    lastUpdated: string;
    description: string;
    lastSignalUpdate?: string;
  };
}

export interface UpdateResult {
  processed: number;
  failed: number;
  signals: {
    BUY: number;
    SELL: number;
    NONE: number;
  };
  errors: string[];
}

// Timezone helper functions
export function toLocalTimezone(date: Date | number = new Date()): string {
  const dateObj = typeof date === 'number' ? new Date(date) : date;
  
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Dublin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(dateObj).replace(', ', 'T') + '.000+01:00';
}

// Helper to parse local timezone string back to Date object
export function fromLocalTimezone(localTimeString: string): Date {
  // Remove the timezone suffix and parse
  const isoString = localTimeString.replace('.000+01:00', '.000Z');
  const utcDate = new Date(isoString);
  // Adjust for timezone offset (subtract 1 hour to get back to UTC)
  return new Date(utcDate.getTime() - (60 * 60 * 1000));
}

// Helper to create expiry time
export function createExpiryTimestamp(
  baseTime: Date | number = new Date(), 
  minutesToAdd: number = 15
): string {
  const baseDate = typeof baseTime === 'number' ? new Date(baseTime) : baseTime;
  const expiryDate = new Date(baseDate.getTime() + minutesToAdd * 60 * 1000);
  return toLocalTimezone(expiryDate);
}