import type { Config } from 'drizzle-kit';

export default {
  dialect: 'sqlite',
  driver: 'expo',
  schema: './src/db/schema.ts',
  out: './drizzle',
} satisfies Config;
