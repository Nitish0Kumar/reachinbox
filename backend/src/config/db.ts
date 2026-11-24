
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

// Create PostgreSQL connection pool
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Handle unexpected database errors
pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL error:", error);
});

// Test database connection
export async function connectDB(): Promise<void> {
  try {
    const result = await pool.query("SELECT NOW()");

    console.log("PostgreSQL connected successfully!");
    console.log("Database time:", result.rows[0].now);
  } catch (error) {
    console.error("PostgreSQL connection failed:", error);
    throw error;
  }
}
