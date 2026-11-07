import express from "express";
import cors from "cors";
import mqtt from "mqtt";
import pool, { testDatabaseConnection } from "./db.js";

const app = express();

const PORT = Number(process.env.PORT || 3001);

// =========================================================
// EXPRESS
// =========================================================

app.use(cors());
app.use(express.json());

// =========================================================
// MQTT - CONFIGURATION EXACTE DE L'ESP32
// =========================================================

const MQTT_BROKER =
  process.env.MQTT_URL || "mqtt://broker.hivemq.com:1883";

const DEVICE_ID = "esp32-01";

// Topics EXACTS utilisés par l'ESP32
const TOPIC_TELEMETRY =
  "iotcloud/2026/groupe_chafi/projet/device01/telemetry";

const TOPIC_STATUS =
  "iotcloud/2026/groupe_chafi/projet/device01/status";

const TOPIC_ALERT =
  "iotcloud/2026/groupe_chafi/projet/device01/alert";

const TOPIC_COMMAND =
  "iotcloud/2026/groupe_chafi/projet/device01/command";

const TOPIC_ACK =
  "iotcloud/2026/groupe_chafi/projet/device01/ack";

// =========================================================
// CONNEXION MQTT
// =========================================================

const mqttClient = mqtt.connect(MQTT_BROKER, {
  clientId: `backend-reservoir-${Date.now()}`,
  clean: true,
  reconnectPeriod: 5000,
  connectTimeout: 10000,
  keepalive: 30,
});

// =========================================================
// MQTT CONNECT
// =========================================================

mqttClient.on("connect", () => {
  console.log("");
  console.log("========================================");
  console.log(" MQTT CONNECTE");
  console.log("========================================");
  console.log("Broker :", MQTT_BROKER);
  console.log("Device :", DEVICE_ID);
  console.log("");
  console.log("COMMAND :", TOPIC_COMMAND);
  console.log("ACK     :", TOPIC_ACK);
  console.log("TELEMETRY:", TOPIC_TELEMETRY);
  console.log("STATUS  :", TOPIC_STATUS);
  console.log("ALERT   :", TOPIC_ALERT);
  console.log("");

  // -------------------------------------------------------
  // ACK
  // -------------------------------------------------------

  mqttClient.subscribe(
    TOPIC_ACK,
    { qos: 1 },
    (error) => {
      if (error) {
        console.error(
          "❌ Erreur abonnement ACK :",
          error.message
        );
      } else {
        console.log(
          "✅ Backend abonné à :",
          TOPIC_ACK
        );
      }
    }
  );

  // -------------------------------------------------------
  // TELEMETRY + STATUS + ALERT
  // -------------------------------------------------------

  mqttClient.subscribe(
    [
      TOPIC_TELEMETRY,
      TOPIC_STATUS,
      TOPIC_ALERT,
    ],
    { qos: 1 },
    (error) => {
      if (error) {
        console.error(
          "❌ Erreur abonnement données ESP32 :",
          error.message
        );
      } else {
        console.log(
          "✅ Backend abonné à telemetry/status/alert"
        );
      }
    }
  );
});

// =========================================================
// MQTT EVENTS
// =========================================================

mqttClient.on("error", (error) => {
  console.error(
    "❌ ERREUR MQTT :",
    error.message
  );
});

mqttClient.on("offline", () => {
  console.log("⚠️ MQTT OFFLINE");
});

mqttClient.on("reconnect", () => {
  console.log(
    "🔄 Reconnexion au broker MQTT..."
  );
});

mqttClient.on("close", () => {
  console.log(
    "⚠️ Connexion MQTT fermée"
  );
});

// =========================================================
// RECEPTION DES MESSAGES MQTT
// =========================================================

mqttClient.on(
  "message",
  async (topic, payload) => {

    const message = payload.toString();

    console.log("");
    console.log("========================================");
    console.log(" MQTT MESSAGE RECU");
    console.log("Topic :", topic);
    console.log("Payload :", message);
    console.log("========================================");

    // =====================================================
    // ACK
    // =====================================================

    if (topic === TOPIC_ACK) {

      try {

        const ack = JSON.parse(message);

        if (
          !ack.commandId ||
          !ack.deviceId ||
          !ack.status
        ) {
          console.error(
            "❌ ACK invalide : champs obligatoires manquants"
          );

          return;
        }

        await pool.query(
          `
          INSERT INTO command_acks (
            command_id,
            device_id,
            status,
            message,
            acknowledged_at
          )
          VALUES ($1, $2, $3, $4, $5)
          `,
          [
            ack.commandId,
            ack.deviceId,
            ack.status,
            ack.message || null,
            ack.timestamp
              ? new Date(ack.timestamp)
              : new Date(),
          ]
        );

        console.log(
          "✅ ACK enregistré dans PostgreSQL"
        );

      } catch (error) {

        console.error(
          "❌ Erreur traitement ACK :",
          error.message
        );
      }

      return;
    }

    // =====================================================
    // TELEMETRY
    // =====================================================

    if (topic === TOPIC_TELEMETRY) {

      try {

        const telemetry = JSON.parse(message);

        console.log(
          "📡 TELEMETRY ESP32 :"
        );

        console.log(
          JSON.stringify(
            telemetry,
            null,
            2
          )
        );

      } catch (error) {

        console.error(
          "❌ Telemetry JSON invalide :",
          error.message
        );
      }

      return;
    }

    // =====================================================
    // STATUS
    // =====================================================

    if (topic === TOPIC_STATUS) {

      try {

        const status = JSON.parse(message);

        console.log(
          "📊 STATUS ESP32 :"
        );

        console.log(
          JSON.stringify(
            status,
            null,
            2
          )
        );

      } catch (error) {

        console.error(
          "❌ Status JSON invalide :",
          error.message
        );
      }

      return;
    }

    // =====================================================
    // ALERT
    // =====================================================

    if (topic === TOPIC_ALERT) {

      try {

        const alert = JSON.parse(message);

        console.log(
          "🚨 ALERT ESP32 :"
        );

        console.log(
          JSON.stringify(
            alert,
            null,
            2
          )
        );

      } catch (error) {

        console.error(
          "❌ Alert JSON invalide :",
          error.message
        );
      }

      return;
    }
  }
);

// =========================================================
// PAGINATION
// =========================================================

function parsePagination(req) {

  let page = Number.parseInt(
    req.query.page,
    10
  );

  let size = Number.parseInt(
    req.query.size,
    10
  );

  if (
    !Number.isInteger(page) ||
    page < 1
  ) {
    page = 1;
  }

  if (
    !Number.isInteger(size) ||
    ![10, 20, 50, 100].includes(size)
  ) {
    size = 20;
  }

  return {
    page,
    size,
    offset: (page - 1) * size,
  };
}

// =========================================================
// PAGINATED QUERY
// =========================================================

async function paginatedQuery({
  req,
  res,
  countQuery,
  dataQuery,
  dataParams = [],
}) {

  try {

    const {
      page,
      size,
      offset,
    } = parsePagination(req);

    const countResult =
      await pool.query(countQuery);

    const total =
      Number(
        countResult.rows[0].total
      );

    const totalPages =
      Math.max(
        1,
        Math.ceil(total / size)
      );

    const dataResult =
      await pool.query(
        dataQuery,
        [
          ...dataParams,
          size,
          offset,
        ]
      );

    res.json({
      data: dataResult.rows,

      pagination: {
        page,
        size,
        total,
        totalPages,
      },
    });

  } catch (error) {

    console.error(
      "Erreur API :",
      error
    );

    res.status(500).json({
      error: "Erreur serveur",
      message:
        "Impossible de récupérer les données PostgreSQL.",
    });
  }
}

// =========================================================
// HEALTH
// =========================================================

app.get(
  "/api/health",
  async (req, res) => {

    try {

      const result =
        await pool.query(`
          SELECT
            NOW() AS server_time,
            current_database() AS database,
            current_user AS user
        `);

      res.json({

        status: "ok",

        database: "connected",

        databaseName:
          result.rows[0].database,

        user:
          result.rows[0].user,

        serverTime:
          result.rows[0].server_time,

        mqtt:
          mqttClient.connected
            ? "connected"
            : "disconnected",

        mqttBroker:
          MQTT_BROKER,

        mqttCommandTopic:
          TOPIC_COMMAND,

        mqttAckTopic:
          TOPIC_ACK,

      });

    } catch (error) {

      console.error(
        "PostgreSQL health error:",
        error
      );

      res.status(500).json({

        status: "error",

        database:
          "disconnected",

        message:
          "PostgreSQL est inaccessible.",
      });
    }
  }
);

// =========================================================
// SENSOR MEASUREMENTS
// =========================================================

app.get(
  "/api/sensor_measurements",
  async (req, res) => {

    await paginatedQuery({

      req,
      res,

      countQuery: `
        SELECT COUNT(*) AS total
        FROM sensor_measurements
      `,

      dataQuery: `
        SELECT
          id,
          device_id,
          niveau_percent,
          distance_cm,
          hauteur_cm,
          puissance_pompe_percent,
          debit_cm_s,
          servo_angle_deg,
          vanne_ouverture_deg,
          fill_time_estimated_s,
          volume_liters,
          measured_at
        FROM sensor_measurements
        ORDER BY measured_at DESC
        LIMIT $1 OFFSET $2
      `,
    });
  }
);

// =========================================================
// DEVICE STATES
// =========================================================

app.get(
  "/api/device_states",
  async (req, res) => {

    await paginatedQuery({

      req,
      res,

      countQuery: `
        SELECT COUNT(*) AS total
        FROM device_states
      `,

      dataQuery: `
        SELECT
          id,
          device_id,
          pompe_state,
          relais_state,
          fuite_state,
          system_state,
          recorded_at
        FROM device_states
        ORDER BY recorded_at DESC
        LIMIT $1 OFFSET $2
      `,
    });
  }
);

// =========================================================
// ALERTS
// =========================================================

app.get(
  "/api/alerts",
  async (req, res) => {

    await paginatedQuery({

      req,
      res,

      countQuery: `
        SELECT COUNT(*) AS total
        FROM alerts
      `,

      dataQuery: `
        SELECT
          id,
          device_id,
          alert_type,
          status,
          level_percent,
          distance_cm,
          message,
          created_at,
          resolved_at
        FROM alerts
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
      `,
    });
  }
);

// =========================================================
// COMMANDS
// =========================================================

app.get(
  "/api/commands",
  async (req, res) => {

    await paginatedQuery({

      req,
      res,

      countQuery: `
        SELECT COUNT(*) AS total
        FROM commands
      `,

      dataQuery: `
        SELECT
          id,
          command_id,
          device_id,
          command_type,
          command_value,
          topic,
          source,
          created_at
        FROM commands
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
      `,
    });
  }
);

// =========================================================
// ACKS
// =========================================================

app.get(
  "/api/command_acks",
  async (req, res) => {

    await paginatedQuery({

      req,
      res,

      countQuery: `
        SELECT COUNT(*) AS total
        FROM command_acks
      `,

      dataQuery: `
        SELECT
          id,
          command_id,
          device_id,
          status,
          message,
          acknowledged_at
        FROM command_acks
        ORDER BY acknowledged_at DESC
        LIMIT $1 OFFSET $2
      `,
    });
  }
);

// =========================================================
// LATEST
// =========================================================

app.get(
  "/api/latest",
  async (req, res) => {

    try {

      const [
        measurementResult,
        stateResult,
        ackResult,
      ] = await Promise.all([

        pool.query(`
          SELECT
            id,
            device_id,
            niveau_percent,
            distance_cm,
            hauteur_cm,
            puissance_pompe_percent,
            debit_cm_s,
            servo_angle_deg,
            vanne_ouverture_deg,
            fill_time_estimated_s,
            volume_liters,
            measured_at
          FROM sensor_measurements
          ORDER BY measured_at DESC
          LIMIT 1
        `),

        pool.query(`
          SELECT
            id,
            device_id,
            pompe_state,
            relais_state,
            fuite_state,
            system_state,
            recorded_at
          FROM device_states
          ORDER BY recorded_at DESC
          LIMIT 1
        `),

        pool.query(`
          SELECT
            id,
            command_id,
            device_id,
            status,
            message,
            acknowledged_at
          FROM command_acks
          ORDER BY acknowledged_at DESC
          LIMIT 1
        `),

      ]);

      res.json({

        measurement:
          measurementResult.rows[0] ||
          null,

        state:
          stateResult.rows[0] ||
          null,

        ack:
          ackResult.rows[0] ||
          null,

      });

    } catch (error) {

      console.error(
        "Erreur /api/latest :",
        error
      );

      res.status(500).json({

        error:
          "Erreur serveur",

        message:
          "Impossible de récupérer les dernières données.",
      });
    }
  }
);

// =========================================================
// POST /api/command
//
// React
//   ↓ HTTP
// /api/command
//   ↓
// Node.js
//   ↓ MQTT
// HiveMQ
//   ↓
// ESP32
// =========================================================

app.post(
  "/api/command",
  async (req, res) => {

    try {

      const {
        command,
        deviceId,
        commandValue = null,
        source = "react",
        seuilBas,
        seuilHaut,
      } = req.body;

      // ---------------------------------------------------
      // COMMANDES AUTORISEES
      // ---------------------------------------------------

      const allowedCommands = [

        "PUMP_ON",

        "PUMP_OFF",

        "RESET_FUITE",

        "SET_DEBIT",

        "SET_SEUILS",

        "RESET_SEUILS",

        "SET_HC_INITIAL",

      ];

      // ---------------------------------------------------
      // VALIDATION COMMANDE
      // ---------------------------------------------------

      if (
        !allowedCommands.includes(command)
      ) {

        return res.status(400).json({

          success: false,

          error:
            "Commande invalide",

          allowedCommands,

        });
      }

      // ---------------------------------------------------
      // VALIDATION DEVICE
      // ---------------------------------------------------

      if (
        typeof deviceId !== "string" ||
        deviceId.trim() === ""
      ) {

        return res.status(400).json({

          success: false,

          error:
            "deviceId est obligatoire",

        });
      }

      // ---------------------------------------------------
      // DEVICE EXACT
      // ---------------------------------------------------

      if (
        deviceId !== DEVICE_ID
      ) {

        return res.status(400).json({

          success: false,

          error:
            "deviceId incorrect",

          expected:
            DEVICE_ID,

        });
      }

      // ---------------------------------------------------
      // MQTT DISPONIBLE ?
      // ---------------------------------------------------

      if (
        !mqttClient.connected
      ) {

        return res.status(503).json({

          success: false,

          error:
            "MQTT non connecté",

          broker:
            MQTT_BROKER,

        });
      }

      // ---------------------------------------------------
      // COMMAND ID
      // ---------------------------------------------------

      const commandId =
        `react-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;

      // ---------------------------------------------------
      // PAYLOAD MQTT DE BASE
      // ---------------------------------------------------

      const mqttPayload = {

        commandId,

        deviceId,

        timestamp:
          new Date().toISOString(),

        command,

        source,

      };

      // ===================================================
      // SET_DEBIT
      // ===================================================

      if (
        command === "SET_DEBIT"
      ) {

        const value =
          Number(commandValue);

        const allowedDebits = [
          5,
          10,
          15,
          20,
          25,
        ];

        if (
          !allowedDebits.includes(value)
        ) {

          return res.status(400).json({

            success: false,

            error:
              "Débit non autorisé",

            allowedValues:
              allowedDebits,

          });
        }

        mqttPayload.value =
          value;
      }

      // ===================================================
      // SET_HC_INITIAL
      // ===================================================

      if (
        command === "SET_HC_INITIAL"
      ) {

        const value =
          Number(commandValue);

        if (
          !Number.isFinite(value) ||
          value < 100 ||
          value > 400
        ) {

          return res.status(400).json({

            success: false,

            error:
              "Distance HC invalide",

            message:
              "La valeur doit être comprise entre 100 et 400 cm.",

          });
        }

        mqttPayload.value =
          value;
      }

      // ===================================================
      // SET_SEUILS
      // ===================================================

      if (
        command === "SET_SEUILS"
      ) {

        const bas =
          Number(seuilBas);

        const haut =
          Number(seuilHaut);

        if (
          !Number.isFinite(bas) ||
          !Number.isFinite(haut)
        ) {

          return res.status(400).json({

            success: false,

            error:
              "Les seuils doivent être numériques.",

          });
        }

        if (
          bas < 0 ||
          haut > 100 ||
          bas >= haut
        ) {

          return res.status(400).json({

            success: false,

            error:
              "Seuils invalides",

            message:
              "Il faut respecter : 0 <= seuilBas < seuilHaut <= 100.",

          });
        }

        mqttPayload.seuilBas =
          bas;

        mqttPayload.seuilHaut =
          haut;
      }

      // ---------------------------------------------------
      // CONVERSION JSON
      // ---------------------------------------------------

      const mqttMessage =
        JSON.stringify(
          mqttPayload
        );

      // ---------------------------------------------------
      // LOG
      // ---------------------------------------------------

      console.log("");
      console.log(
        "========================================"
      );

      console.log(
        "📤 PUBLICATION COMMANDE MQTT"
      );

      console.log(
        "Broker :",
        MQTT_BROKER
      );

      console.log(
        "Topic :",
        TOPIC_COMMAND
      );

      console.log(
        "Payload :",
        mqttMessage
      );

      console.log(
        "========================================"
      );

      // ===================================================
      // PUBLICATION MQTT
      // ===================================================

      await new Promise(
        (resolve, reject) => {

          mqttClient.publish(

            TOPIC_COMMAND,

            mqttMessage,

            {
              qos: 1,
              retain: false,
            },

            (error) => {

              if (error) {

                reject(error);

              } else {

                resolve();

              }
            }
          );
        }
      );

      console.log(
        "✅ COMMANDE PUBLIEE SUR MQTT"
      );

      // ===================================================
      // VALEUR POUR POSTGRESQL
      // ===================================================

      let databaseCommandValue =
        commandValue;

      if (
        command === "SET_SEUILS"
      ) {

        databaseCommandValue =
          JSON.stringify({

            seuilBas:
              Number(seuilBas),

            seuilHaut:
              Number(seuilHaut),

          });
      }

      // ===================================================
      // ENREGISTREMENT POSTGRESQL
      // ===================================================

      const result =
        await pool.query(

          `
          INSERT INTO commands (
            command_id,
            device_id,
            command_type,
            command_value,
            topic,
            source
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6
          )
          RETURNING *
          `,

          [

            commandId,

            deviceId,

            command,

            databaseCommandValue,

            TOPIC_COMMAND,

            source,

          ]
        );

      // ===================================================
      // REPONSE HTTP VERS REACT
      // ===================================================

      return res.status(201).json({

        success: true,

        message:
          "Commande envoyée à l'ESP32 via MQTT.",

        command:
          result.rows[0],

        mqtt: {

          broker:
            MQTT_BROKER,

          topic:
            TOPIC_COMMAND,

          connected:
            mqttClient.connected,

        },

        payload:
          mqttPayload,

      });

    } catch (error) {

      console.error(
        "❌ ERREUR POST /api/command :",
        error
      );

      return res.status(500).json({

        success: false,

        error:
          "Erreur serveur",

        message:
          error.message,

      });
    }
  }
);

// =========================================================
// 404
// =========================================================

app.use(
  (req, res) => {

    res.status(404).json({

      error:
        "Endpoint introuvable",

      path:
        req.originalUrl,

    });
  }
);

// =========================================================
// START SERVER
// =========================================================

app.listen(
  PORT,
  async () => {

    console.log("");
    console.log(
      "========================================"
    );

    console.log(
      "   RESERVOIR INTELLIGENT - API"
    );

    console.log(
      "========================================"
    );

    console.log(
      `API : http://localhost:${PORT}`
    );

    console.log(
      `MQTT : ${MQTT_BROKER}`
    );

    console.log(
      `DEVICE : ${DEVICE_ID}`
    );

    console.log("");
    console.log(
      "HTTP COMMAND :"
    );

    console.log(
      `POST http://localhost:${PORT}/api/command`
    );

    console.log("");
    console.log(
      "MQTT COMMAND :"
    );

    console.log(
      TOPIC_COMMAND
    );

    console.log("");
    console.log(
      "MQTT ACK :"
    );

    console.log(
      TOPIC_ACK
    );

    console.log(
      "========================================"
    );

    try {

      await testDatabaseConnection();

      console.log(
        "✅ PostgreSQL connecté"
      );

    } catch (error) {

      console.error(
        "❌ Connexion PostgreSQL impossible"
      );

      console.error(
        error.message
      );
    }
  }
);
