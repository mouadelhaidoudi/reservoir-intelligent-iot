module.exports = function (RED) {
  const { Pool } = require("pg");

  function PostgreSQLConfig(config) {
    RED.nodes.createNode(this, config);
    const credentials = this.credentials || {};
    this.pool = new Pool({
      host: config.host,
      port: Number(config.port || 5432),
      database: config.database,
      user: credentials.user || process.env.POSTGRES_USER || "reservoir_user",
      password: credentials.password || process.env.POSTGRES_PASSWORD || "reservoir_password",
      ssl: String(config.ssl) === "true" ? { rejectUnauthorized: false } : false,
      max: Number(config.max || 10),
      connectionTimeoutMillis: Number(config.connectionTimeout || 10000),
      idleTimeoutMillis: Number(config.idle || 1000)
    });
    this.on("close", () => this.pool.end());
  }

  RED.nodes.registerType("postgreSQLConfig", PostgreSQLConfig, {
    credentials: {
      user: { type: "text" },
      password: { type: "password" }
    }
  });

  function PostgreSQLNode(config) {
    RED.nodes.createNode(this, config);
    const db = RED.nodes.getNode(config.postgreSQLConfig);
    this.on("input", async (msg, send, done) => {
      if (!db?.pool) {
        const error = new Error("PostgreSQL configuration is unavailable");
        this.error(error, msg);
        done?.(error);
        return;
      }
      try {
        const result = await db.pool.query(msg.query || config.query, msg.params || []);
        msg.payload = result.rows;
        msg.rowCount = result.rowCount;
        send(msg);
        done?.();
      } catch (error) {
        this.error(error, msg);
        done?.(error);
      }
    });
  }

  RED.nodes.registerType("postgresql", PostgreSQLNode);
};
