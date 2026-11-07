import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || "postgres",
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || "reservoir_db",
  user: process.env.DB_USER || "reservoir_user",
  password: process.env.DB_PASSWORD || "reservoir_password",
  ssl: process.env.DB_SSL === "true",
});

pool.on("error", (err) => {
  console.error("Erreur PostgreSQL :", err);
});

export async function testDatabaseConnection() {
  const client = await pool.connect();

  try {
    const result = await client.query(
      "SELECT current_database() AS database, current_user AS user"
    );

    console.log("=================================");
    console.log("PostgreSQL connecté");
    console.log("Base :", result.rows[0].database);
    console.log("Utilisateur :", result.rows[0].user);
    console.log("=================================");

    return result.rows[0];
  } finally {
    client.release();
  }
}

export default pool;
