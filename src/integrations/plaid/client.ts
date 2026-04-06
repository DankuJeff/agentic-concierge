/**
 * Plaid API client — sandbox environment.
 *
 * Provides four operations used by the Finance Agent and Plaid routes:
 *   createLinkToken    — frontend calls this to initialise Plaid Link
 *   exchangePublicToken — called after Link completes; returns access token + item ID
 *   getAccounts        — accounts with current/available balances
 *   getTransactions    — recent transactions (last N days, up to 500)
 *
 * Access tokens are encrypted before storage (see routes/plaid.ts).
 *
 * Requires:
 *   PLAID_CLIENT_ID   — from Plaid Dashboard
 *   PLAID_SECRET      — sandbox secret from Plaid Dashboard
 */

import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
  type AccountBase,
  type Transaction,
} from 'plaid';

if (!process.env['PLAID_CLIENT_ID'] || !process.env['PLAID_SECRET']) {
  console.warn(
    '[plaid] PLAID_CLIENT_ID or PLAID_SECRET is not set. Financial data endpoints will be unavailable.',
  );
}

const config = new Configuration({
  basePath: PlaidEnvironments['sandbox'],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env['PLAID_CLIENT_ID'] ?? '',
      'PLAID-SECRET': process.env['PLAID_SECRET'] ?? '',
    },
  },
});

export const plaidClient = new PlaidApi(config);

// ── Public types ───────────────────────────────────────────

export interface PlaidAccount {
  accountId: string;
  name: string;
  officialName: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  balances: {
    available: number | null;
    current: number | null;
    limit: number | null;
    isoCurrencyCode: string | null;
  };
}

export interface PlaidTransaction {
  transactionId: string;
  accountId: string;
  date: string;
  name: string;
  amount: number; // positive = debit (money out), negative = credit (money in)
  category: string[];
  merchantName: string | null;
  pending: boolean;
  isoCurrencyCode: string | null;
}

// ── Operations ─────────────────────────────────────────────

/**
 * Creates a Link token for the frontend Plaid Link flow.
 * The userId is stored as the client_user_id so Plaid can associate
 * the resulting Item with the correct user in webhook events.
 */
export async function createLinkToken(userId: string): Promise<string> {
  const response = await plaidClient.linkTokenCreate({
    user: { client_user_id: userId },
    client_name: 'Agentic Concierge',
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: 'en',
  });
  return response.data.link_token;
}

/**
 * Exchanges a public token (from Plaid Link) for a durable access token.
 * Returns the access token and item ID — both should be persisted on the user row.
 */
export async function exchangePublicToken(
  publicToken: string,
): Promise<{ accessToken: string; itemId: string }> {
  const response = await plaidClient.itemPublicTokenExchange({
    public_token: publicToken,
  });
  return {
    accessToken: response.data.access_token,
    itemId: response.data.item_id,
  };
}

/**
 * Fetches all accounts with current balances for the given access token.
 */
export async function getAccounts(accessToken: string): Promise<PlaidAccount[]> {
  const response = await plaidClient.accountsBalanceGet({ access_token: accessToken });
  return response.data.accounts.map(mapAccount);
}

/**
 * Fetches up to 500 transactions from the last `days` days.
 * Plaid paginates — we fetch all pages and return the full list.
 */
export async function getTransactions(
  accessToken: string,
  days = 90,
): Promise<PlaidTransaction[]> {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const endDate = new Date().toISOString().slice(0, 10);

  const all: Transaction[] = [];
  let offset = 0;
  const count = 100;

  while (true) {
    const response = await plaidClient.transactionsGet({
      access_token: accessToken,
      start_date: startDate,
      end_date: endDate,
      options: { count, offset },
    });

    all.push(...response.data.transactions);

    if (all.length >= response.data.total_transactions || all.length >= 500) break;
    offset += count;
  }

  return all.map(mapTransaction);
}

// ── Mappers ────────────────────────────────────────────────

function mapAccount(a: AccountBase): PlaidAccount {
  return {
    accountId: a.account_id,
    name: a.name,
    officialName: a.official_name ?? null,
    type: a.type,
    subtype: a.subtype ?? null,
    mask: a.mask ?? null,
    balances: {
      available: a.balances.available ?? null,
      current: a.balances.current ?? null,
      limit: a.balances.limit ?? null,
      isoCurrencyCode: a.balances.iso_currency_code ?? null,
    },
  };
}

function mapTransaction(t: Transaction): PlaidTransaction {
  return {
    transactionId: t.transaction_id,
    accountId: t.account_id,
    date: t.date,
    name: t.name,
    amount: t.amount,
    category: t.category ?? [],
    merchantName: t.merchant_name ?? null,
    pending: t.pending,
    isoCurrencyCode: t.iso_currency_code ?? null,
  };
}
