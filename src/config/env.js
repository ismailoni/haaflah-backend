import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import dns from 'dns';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Always prefer IPv4 to avoid ENETUNREACH on Render
dns.setDefaultResultOrder('ipv4first');

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

// Support DATABASE_URL if defined (Render-friendly)
let dbConfig = {};
if (process.env.DATABASE_URL) {
  dbConfig = { url: process.env.DATABASE_URL };
} else {
  dbConfig = {
    name: process.env.DB_NAME,
    user: process.env.DB_USER,
    pass: process.env.DB_PASSWORD,
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
  };
}

export const config = {
  db: dbConfig,
  port: process.env.PORT || 4000,
  jwtSecret: process.env.JWT_SECRET,
  frontendUrl: process.env.FRONTEND_URL,
};
