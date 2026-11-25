import path from 'node:path';

function intFromEnv(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid integer in environment: ${value}`);
  return n;
}

export function loadConfig(env = process.env) {
  const baseUrl = (env.BASE_URL || '').replace(/\/+$/, '');
  return {
    port: intFromEnv(env.PORT, 3000),
    dataDir: path.resolve(env.DATA_DIR || 'data'),
    baseUrl,
    adminPassword: env.ADMIN_PASSWORD || '',
    vodafoneCash: env.VODAFONE_CASH_NUMBER || '',
    instapay: env.INSTAPAY_ADDRESS || '',
    supportWhatsapp: env.SUPPORT_WHATSAPP || '',
    priceMonthly: intFromEnv(env.PRICE_MONTHLY_EGP, 99),
    priceYearly: intFromEnv(env.PRICE_YEARLY_EGP, 990),
    freeProductLimit: intFromEnv(env.FREE_PRODUCT_LIMIT, 10),
    trialDays: intFromEnv(env.TRIAL_DAYS, 14),
    referralRewardDays: intFromEnv(env.REFERRAL_REWARD_DAYS, 30),
    signupsPerHourPerIp: intFromEnv(env.SIGNUPS_PER_HOUR_PER_IP, 30),
    trustProxy: env.TRUST_PROXY === '1',
    secureCookies: env.NODE_ENV === 'production' || baseUrl.startsWith('https://'),
  };
}
