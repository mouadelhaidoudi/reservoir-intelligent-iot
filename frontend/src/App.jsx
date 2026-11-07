import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import * as XLSX from "xlsx";
import "./App.css";

/* =========================================================
   CONFIGURATION
========================================================= */

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3001/api";
const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:1880/ws/reservoir";

const DEVICE_ID_DEFAULT = "esp32-01";

const WS_RECONNECT_DELAY = 4000;

const HISTORY_PAGE_SIZES = [10, 20, 50, 100];

const RESERVOIR_HEIGHT_CM = 300;
const PHYSICAL_TOLERANCE_CM = 5;

/* =========================================================
   UTILITAIRES
========================================================= */

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function formatNumber(value, decimals = 1) {
  if (!isFiniteNumber(value)) {
    return "—";
  }

  return value.toFixed(decimals);
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleString("fr-FR");
}

function formatTime(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleTimeString("fr-FR");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/* =========================================================
   NORMALISATION WEBSOCKET
========================================================= */

function normalizeWebSocketMessage(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const data =
    payload.dashboardData ??
    payload.data ??
    payload.telemetry ??
    payload;

  if (!data || typeof data !== "object") {
    return null;
  }

  return {
    deviceId:
      data.deviceId ??
      data.device_id ??
      DEVICE_ID_DEFAULT,

    timestamp:
      data.timestamp ??
      data.measured_at ??
      data.recorded_at ??
      new Date().toISOString(),

    ...data,
  };
}

/* =========================================================
   VALIDATION TELEMETRIE
========================================================= */

function validateTelemetry(raw) {
  const errors = [];
  const accepted = {};

  const distance = toNumber(
    raw.distance_cm ?? raw.distance
  );

  const niveau = toNumber(
    raw.niveau_percent ?? raw.niveau
  );

  const hauteur = toNumber(
    raw.hauteur_cm ?? raw.hauteur
  );

  const volume = toNumber(
    raw.volume_liters ?? raw.volume
  );

  const puissance = toNumber(
    raw.puissance_pompe_percent ??
      raw.puissance
  );

  const debit = toNumber(
    raw.debit_cm_s ?? raw.debit
  );

  const servo = toNumber(
    raw.servo_angle_deg ?? raw.servo
  );

  const vanne = toNumber(
    raw.vanne_ouverture_deg ?? raw.vanne
  );

  const temps = toNumber(
    raw.fill_time_estimated_s ?? raw.temps
  );

  if (distance !== null) {
    if (distance < 0 || distance > 400) {
      errors.push({
        type: "ERROR",
        message: `Distance invalide : ${distance} cm.`,
      });
    } else {
      accepted.distance = distance;
    }
  }

  if (niveau !== null) {
    if (niveau < 0 || niveau > 100) {
      errors.push({
        type: "ERROR",
        message: `Niveau invalide : ${niveau} %.`,
      });
    } else {
      accepted.niveau = niveau;
    }
  }

  if (hauteur !== null) {
    if (
      hauteur < 0 ||
      hauteur > RESERVOIR_HEIGHT_CM
    ) {
      errors.push({
        type: "ERROR",
        message: `Hauteur invalide : ${hauteur} cm.`,
      });
    } else {
      accepted.hauteur = hauteur;
    }
  }

  if (volume !== null) {
    if (volume < 0) {
      errors.push({
        type: "ERROR",
        message: `Volume invalide : ${volume} L.`,
      });
    } else {
      accepted.volume = volume;
    }
  }

  if (puissance !== null) {
    if (puissance < 0 || puissance > 100) {
      errors.push({
        type: "ERROR",
        message: `Puissance pompe invalide : ${puissance} %.`,
      });
    } else {
      accepted.puissance = puissance;
    }
  }

  if (debit !== null) {
    if (debit < 0) {
      errors.push({
        type: "ERROR",
        message: `Débit invalide : ${debit}.`,
      });
    } else {
      accepted.debit = debit;
    }
  }

  if (servo !== null) {
    if (servo < 0 || servo > 180) {
      errors.push({
        type: "ERROR",
        message: `Servo invalide : ${servo}°.`,
      });
    } else {
      accepted.servo = servo;
    }
  }

  if (vanne !== null) {
    if (vanne < 0 || vanne > 180) {
      errors.push({
        type: "ERROR",
        message: `Vanne invalide : ${vanne}°.`,
      });
    } else {
      accepted.vanne = vanne;
    }
  }

  if (temps !== null) {
    if (temps < 0) {
      errors.push({
        type: "ERROR",
        message: `Temps invalide : ${temps} s.`,
      });
    } else {
      accepted.temps = temps;
    }
  }

  /* Cohérence distance / hauteur */

  if (
    distance !== null &&
    hauteur !== null
  ) {
    const expectedHeight =
      RESERVOIR_HEIGHT_CM - distance;

    if (
      Math.abs(
        expectedHeight - hauteur
      ) > PHYSICAL_TOLERANCE_CM
    ) {
      errors.push({
        type: "WARNING",
        message:
          `Incohérence : distance ${distance} cm, hauteur reçue ${hauteur} cm.`,
      });
    }
  }

  /* Cohérence niveau / hauteur */

  if (
    niveau !== null &&
    hauteur !== null
  ) {
    const expectedLevel =
      (hauteur / RESERVOIR_HEIGHT_CM) * 100;

    if (
      Math.abs(
        expectedLevel - niveau
      ) > 5
    ) {
      errors.push({
        type: "WARNING",
        message:
          `Incohérence : hauteur ${hauteur} cm, niveau ${niveau} %.`,
      });
    }
  }

  return {
    accepted,
    errors,
  };
}

/* =========================================================
   APP
========================================================= */

export default function App() {
  const [authenticated, setAuthenticated] =
    useState(
      sessionStorage.getItem(
        "authenticated"
      ) === "true"
    );

  if (!authenticated) {
    return (
      <Login
        onLogin={() => {
          sessionStorage.setItem(
            "authenticated",
            "true"
          );

          setAuthenticated(true);
        }}
      />
    );
  }

  return (
    <Dashboard
      onLogout={() => {
        sessionStorage.removeItem(
          "authenticated"
        );

        setAuthenticated(false);
      }}
    />
  );
}

/* =========================================================
   LOGIN
========================================================= */

function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(event) {
    event.preventDefault();

    if (
      username === "admin" &&
      password === "admin1234"
    ) {
      setError("");
      onLogin();
      return;
    }

    setError(
      "Identifiant ou mot de passe incorrect."
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          💧
        </div>

        <h1>Réservoir Intelligent</h1>

        <p>
          Système de supervision IoT
        </p>

        <form onSubmit={handleSubmit}>
          <label>Nom utilisateur</label>

          <input
            value={username}
            onChange={(e) =>
              setUsername(e.target.value)
            }
            placeholder="admin"
            autoComplete="username"
          />

          <label>Mot de passe</label>

          <input
            type="password"
            value={password}
            onChange={(e) =>
              setPassword(e.target.value)
            }
            placeholder="Mot de passe"
            autoComplete="current-password"
          />

          {error && (
            <div className="login-error">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="primary-button full-width"
          >
            Se connecter
          </button>
        </form>

        <div className="login-footer">
          Supervision du réservoir
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   DASHBOARD
========================================================= */

function Dashboard({ onLogout }) {
  const [telemetry, setTelemetry] =
    useState({
      deviceId: DEVICE_ID_DEFAULT,
      niveau: null,
      distance: null,
      hauteur: null,
      volume: null,
      temps: null,
      puissance: null,
      debit: null,
      pompe: null,
      relais: null,
      servo: null,
      vanne: null,
      systeme: null,
      fuite: null,
      timestamp: null,
    });

  const [wsConnected, setWsConnected] =
    useState(false);

  const [apiConnected, setApiConnected] =
    useState(false);

  const [alerts, setAlerts] =
    useState([]);

  const [latestAck, setLatestAck] =
    useState(null);

  const [history, setHistory] =
    useState([]);

  const [historyLoading, setHistoryLoading] =
    useState(false);

  const [historyError, setHistoryError] =
    useState("");

  const [activeTab, setActiveTab] =
    useState("measurements");

  const [page, setPage] =
    useState(1);

  const [pageSize, setPageSize] =
    useState(20);

  const [pagination, setPagination] =
    useState({
      page: 1,
      size: 20,
      total: 0,
      totalPages: 1,
    });

  const [search, setSearch] =
    useState("");

  const [sortKey, setSortKey] =
    useState("");

  const [sortDirection, setSortDirection] =
    useState("desc");

  const [commandStatus, setCommandStatus] =
    useState("");

  const [apiError, setApiError] =
    useState("");

  const [exportLoading, setExportLoading] =
    useState(false);

  /*
   * =======================================================
   * NOUVEAUX INPUTS COMMANDES
   * =======================================================
   */

  const [selectedDebit, setSelectedDebit] =
    useState(25);

  const [seuilBas, setSeuilBas] =
    useState(20);

  const [seuilHaut, setSeuilHaut] =
    useState(60);

  const [hcInitial, setHcInitial] =
    useState(300);

  const socketRef = useRef(null);

  const reconnectTimerRef =
    useRef(null);

  const mountedRef =
    useRef(true);

  const lastValidRef =
    useRef({
      ...telemetry,
    });

  /* =====================================================
     ALERT
  ===================================================== */

  const addAlert = useCallback(
    (type, message) => {
      setAlerts((previous) => [
        {
          id:
            Date.now() +
            Math.random(),

          type,

          message,

          time:
            new Date().toISOString(),
        },

        ...previous,
      ].slice(0, 20));
    },
    []
  );

  /* =====================================================
     APPLICATION TELEMETRIE
  ===================================================== */

  const applyTelemetry =
    useCallback(
      (raw) => {
        const normalized =
          normalizeWebSocketMessage(
            raw
          );

        if (!normalized) {
          addAlert(
            "ERROR",
            "Message WebSocket invalide."
          );

          return;
        }

        const validation =
          validateTelemetry(
            normalized
          );

        validation.errors.forEach(
          (error) => {
            addAlert(
              error.type,
              error.message
            );
          }
        );

        const previous =
          lastValidRef.current;

        const accepted =
          validation.accepted;

        const next = {
          ...previous,
        };

        Object.entries(
          accepted
        ).forEach(
          ([key, value]) => {
            next[key] = value;
          }
        );

        if (
          normalized.pompe !==
          undefined
        ) {
          next.pompe =
            normalized.pompe;
        }

        if (
          normalized.relais !==
          undefined
        ) {
          next.relais =
            normalized.relais;
        }

        if (
          normalized.systeme !==
          undefined
        ) {
          next.systeme =
            normalized.systeme;
        }

        if (
          normalized.fuite !==
          undefined
        ) {
          next.fuite =
            normalized.fuite;
        }

        if (
          normalized.deviceId
        ) {
          next.deviceId =
            normalized.deviceId;
        }

        const timestamp =
          new Date(
            normalized.timestamp
          );

        if (
          !Number.isNaN(
            timestamp.getTime()
          )
        ) {
          next.timestamp =
            timestamp.toISOString();
        }

        lastValidRef.current =
          next;

        setTelemetry(next);
      },
      [addAlert]
    );

  /* =====================================================
     WEBSOCKET NODE-RED
  ===================================================== */

  useEffect(() => {
    mountedRef.current = true;

    function connect() {
      if (!mountedRef.current) {
        return;
      }

      try {
        const socket =
          new WebSocket(WS_URL);

        socketRef.current =
          socket;

        socket.onopen = () => {
          setWsConnected(true);

          addAlert(
            "INFO",
            "WebSocket Node-RED connecté."
          );
        };

        socket.onmessage = (
          event
        ) => {
          try {
            const payload =
              JSON.parse(
                event.data
              );

            applyTelemetry(
              payload
            );
          } catch {
            addAlert(
              "ERROR",
              "Message WebSocket JSON invalide."
            );
          }
        };

        socket.onerror = () => {
          setWsConnected(false);
        };

        socket.onclose = () => {
          if (
            !mountedRef.current
          ) {
            return;
          }

          setWsConnected(false);

          reconnectTimerRef.current =
            setTimeout(
              connect,
              WS_RECONNECT_DELAY
            );
        };
      } catch {
        setWsConnected(false);

        reconnectTimerRef.current =
          setTimeout(
            connect,
            WS_RECONNECT_DELAY
          );
      }
    }

    connect();

    return () => {
      mountedRef.current =
        false;

      if (
        reconnectTimerRef.current
      ) {
        clearTimeout(
          reconnectTimerRef.current
        );
      }

      if (
        socketRef.current
      ) {
        socketRef.current.close();
      }
    };
  }, [
    addAlert,
    applyTelemetry,
  ]);

  /* =====================================================
     API REQUEST
  ===================================================== */

  const apiRequest =
    useCallback(
      async (
        endpoint,
        options = {}
      ) => {
        const controller =
          new AbortController();

        const timeout =
          setTimeout(
            () =>
              controller.abort(),
            10000
          );

        try {
          const response =
            await fetch(
              `${API_BASE}${endpoint}`,
              {
                ...options,

                signal:
                  controller.signal,

                headers: {
                  "Content-Type":
                    "application/json",

                  ...(options.headers ||
                    {}),
                },
              }
            );

          let payload;

          try {
            payload =
              await response.json();
          } catch {
            throw new Error(
              "Réponse JSON invalide."
            );
          }

          if (!response.ok) {
            throw new Error(
              payload.message ||
                payload.error ||
                `Erreur HTTP ${response.status}`
            );
          }

          setApiConnected(true);
          setApiError("");

          return payload;
        } catch (error) {
          setApiConnected(false);

          throw error;
        } finally {
          clearTimeout(timeout);
        }
      },
      []
    );

  /* =====================================================
     API HEALTH
  ===================================================== */

  const checkApi =
    useCallback(
      async () => {
        try {
          await apiRequest(
            "/health"
          );
        } catch (error) {
          setApiError(
            error.message
          );
        }
      },
      [apiRequest]
    );

  useEffect(() => {
    checkApi();

    const interval =
      setInterval(
        checkApi,
        15000
      );

    return () =>
      clearInterval(
        interval
      );
  }, [checkApi]);

  /* =====================================================
     DERNIER ACK
  ===================================================== */

  const loadLatestAck =
    useCallback(
      async () => {
        try {
          const result =
            await apiRequest(
              "/latest"
            );

          if (result.ack) {
            setLatestAck(
              result.ack
            );
          }
        } catch {
          // L'API health gère déjà l'état.
        }
      },
      [apiRequest]
    );

  useEffect(() => {
    loadLatestAck();

    const interval =
      setInterval(
        loadLatestAck,
        10000
      );

    return () =>
      clearInterval(
        interval
      );
  }, [loadLatestAck]);

  /* =====================================================
     HISTORIQUE POSTGRESQL
  ===================================================== */

  const endpoints =
    useMemo(
      () => ({
        measurements:
          "/sensor_measurements",

        states:
          "/device_states",

        alerts:
          "/alerts",

        commands:
          "/commands",

        acks:
          "/command_acks",
      }),
      []
    );

  const loadHistory =
    useCallback(
      async () => {
        setHistoryLoading(
          true
        );

        setHistoryError("");

        try {
          const endpoint =
            endpoints[
              activeTab
            ];

          const result =
            await apiRequest(
              `${endpoint}?page=${page}&size=${pageSize}`
            );

          setHistory(
            Array.isArray(
              result.data
            )
              ? result.data
              : []
          );

          if (
            result.pagination
          ) {
            setPagination(
              result.pagination
            );
          }
        } catch (error) {
          setHistoryError(
            error.message
          );
        } finally {
          setHistoryLoading(
            false
          );
        }
      },
      [
        activeTab,
        apiRequest,
        endpoints,
        page,
        pageSize,
      ]
    );

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  /* =====================================================
     RECHERCHE / TRI
  ===================================================== */

  const displayedHistory =
    useMemo(() => {
      let rows = [
        ...history,
      ];

      if (search.trim()) {
        const query =
          search
            .toLowerCase()
            .trim();

        rows =
          rows.filter(
            (row) =>
              Object.values(
                row
              ).some(
                (value) =>
                  String(
                    value
                  )
                    .toLowerCase()
                    .includes(
                      query
                    )
              )
          );
      }

      if (sortKey) {
        rows.sort(
          (a, b) => {
            const av =
              a[sortKey];

            const bv =
              b[sortKey];

            if (av === bv) {
              return 0;
            }

            const ad =
              Date.parse(av);

            const bd =
              Date.parse(bv);

            if (
              !Number.isNaN(ad) &&
              !Number.isNaN(bd)
            ) {
              return sortDirection ===
                "asc"
                ? ad - bd
                : bd - ad;
            }

            const an =
              Number(av);

            const bn =
              Number(bv);

            if (
              Number.isFinite(an) &&
              Number.isFinite(bn)
            ) {
              return sortDirection ===
                "asc"
                ? an - bn
                : bn - an;
            }

            return (
              String(av).localeCompare(
                String(bv)
              ) *
              (sortDirection ===
              "asc"
                ? 1
                : -1)
            );
          }
        );
      }

      return rows;
    }, [
      history,
      search,
      sortKey,
      sortDirection,
    ]);

  function handleSort(key) {
    if (sortKey === key) {
      setSortDirection(
        (previous) =>
          previous === "asc"
            ? "desc"
            : "asc"
      );
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  }

  function changeTab(tab) {
    setActiveTab(tab);
    setPage(1);
    setSearch("");
    setSortKey("");
  }

  /* =====================================================
     GRAPHIQUES
  ===================================================== */

  const chartData =
    useMemo(
      () =>
        history
          .slice()
          .reverse()
          .map((row) => ({
            time: formatTime(
              row.measured_at
            ),

            niveau:
              toNumber(
                row.niveau_percent
              ),

            distance:
              toNumber(
                row.distance_cm
              ),

            puissance:
              toNumber(
                row.puissance_pompe_percent
              ),

            debit:
              toNumber(
                row.debit_cm_s
              ),
          })),
      [history]
    );

  /* =====================================================
     COMMANDES MQTT
  ===================================================== */

  async function sendCommand(
    command,
    extraData = {}
  ) {
    setCommandStatus(
      `Envoi de ${command}...`
    );

    try {
      const result =
        await apiRequest(
          "/command",
          {
            method: "POST",

            body: JSON.stringify({
              command,

              deviceId:
                telemetry.deviceId ||
                DEVICE_ID_DEFAULT,

              ...extraData,
            }),
          }
        );

      setCommandStatus(
        `✓ ${command} envoyée`
      );

      addAlert(
        "INFO",
        `Commande ${command} envoyée via MQTT.`
      );

      if (result.command) {
        setLatestAck(null);
      }

      setTimeout(
        loadHistory,
        500
      );
    } catch (error) {
      setCommandStatus(
        `❌ ${error.message}`
      );

      addAlert(
        "ERROR",
        `Commande refusée : ${error.message}`
      );
    }
  }

  /* =====================================================
     SET DEBIT
  ===================================================== */

  function handleSetDebit() {
    const value =
      Number(selectedDebit);

    const allowed = [
      5,
      10,
      15,
      20,
      25,
    ];

    if (!allowed.includes(value)) {
      addAlert(
        "ERROR",
        "Débit invalide. Valeurs autorisées : 5, 10, 15, 20 ou 25."
      );

      return;
    }

    sendCommand(
      "SET_DEBIT",
      {
        commandValue: value,
      }
    );
  }

  /* =====================================================
     SET SEUILS
  ===================================================== */

  function handleSetSeuils() {
    const bas =
      Number(seuilBas);

    const haut =
      Number(seuilHaut);

    if (
      !Number.isFinite(bas) ||
      !Number.isFinite(haut)
    ) {
      addAlert(
        "ERROR",
        "Les seuils doivent être numériques."
      );

      return;
    }

    if (
      bas < 0 ||
      haut > 100 ||
      bas >= haut
    ) {
      addAlert(
        "ERROR",
        "Seuils invalides : 0 ≤ seuil bas < seuil haut ≤ 100."
      );

      return;
    }

    sendCommand(
      "SET_SEUILS",
      {
        seuilBas: bas,
        seuilHaut: haut,
      }
    );
  }

  /* =====================================================
     RESET SEUILS
  ===================================================== */

  function handleResetSeuils() {
    setSeuilBas(20);
    setSeuilHaut(60);

    sendCommand(
      "RESET_SEUILS"
    );
  }

  /* =====================================================
     SET HC INITIAL
  ===================================================== */

  function handleSetHcInitial() {
    const value =
      Number(hcInitial);

    if (
      !Number.isFinite(value) ||
      value < 100 ||
      value > 400
    ) {
      addAlert(
        "ERROR",
        "La distance HC initiale doit être comprise entre 100 et 400 cm."
      );

      return;
    }

    sendCommand(
      "SET_HC_INITIAL",
      {
        commandValue: value,
      }
    );
  }

  /* =====================================================
     EXPORT
  ===================================================== */

  function normalizeExportRows(
    rows
  ) {
    return rows.map(
      (row) => {
        const clean = {};

        Object.entries(
          row
        ).forEach(
          ([key, value]) => {
            clean[key] =
              value === null ||
              value === undefined
                ? ""
                : value;
          }
        );

        return clean;
      }
    );
  }

  async function exportCurrentTable() {
    setExportLoading(true);

    try {
      const result =
        await apiRequest(
          `${endpoints[activeTab]}?page=1&size=100`
        );

      const rows =
        normalizeExportRows(
          result.data || []
        );

      const workbook =
        XLSX.utils.book_new();

      const worksheet =
        XLSX.utils.json_to_sheet(
          rows
        );

      XLSX.utils.book_append_sheet(
        workbook,
        worksheet,
        getTabLabel(
          activeTab
        ).slice(0, 31)
      );

      XLSX.writeFile(
        workbook,
        "reservoir_table.xlsx"
      );

      addAlert(
        "INFO",
        "Export terminé."
      );
    } catch (error) {
      addAlert(
        "ERROR",
        `Export impossible : ${error.message}`
      );
    } finally {
      setExportLoading(false);
    }
  }

  async function exportAllData() {
    setExportLoading(true);

    try {
      const workbook =
        XLSX.utils.book_new();

      const tabs = [
        {
          key: "measurements",
          name: "Mesures",
        },
        {
          key: "states",
          name: "Etats",
        },
        {
          key: "alerts",
          name: "Alertes",
        },
        {
          key: "commands",
          name: "Commandes",
        },
        {
          key: "acks",
          name: "ACK",
        },
      ];

      for (
        const tab of tabs
      ) {
        const result =
          await apiRequest(
            `${endpoints[tab.key]}?page=1&size=100`
          );

        const worksheet =
          XLSX.utils.json_to_sheet(
            normalizeExportRows(
              result.data || []
            )
          );

        XLSX.utils.book_append_sheet(
          workbook,
          worksheet,
          tab.name
        );
      }

      const info =
        XLSX.utils.aoa_to_sheet([
          [
            "Date export",
            new Date().toLocaleString(
              "fr-FR"
            ),
          ],

          [
            "Device",
            telemetry.deviceId,
          ],
        ]);

      XLSX.utils.book_append_sheet(
        workbook,
        info,
        "Informations"
      );

      XLSX.writeFile(
        workbook,
        "reservoir_export.xlsx"
      );

      addAlert(
        "INFO",
        "Export complet terminé."
      );
    } catch (error) {
      addAlert(
        "ERROR",
        `Export impossible : ${error.message}`
      );
    } finally {
      setExportLoading(false);
    }
  }

  /* =====================================================
     COULEUR NIVEAU
  ===================================================== */

  function getLevelColor(
    level
  ) {
    if (!isFiniteNumber(level)) {
      return "#22c1dc";
    }

    if (level <= 10) {
      return "#ef4444";
    }

    if (level <= 30) {
      return "#f59e0b";
    }

    return "#22c1dc";
  }

  const fuiteActive =
    String(
      telemetry.fuite
    ).toLowerCase() ===
      "active" ||
    String(
      telemetry.fuite
    ).toLowerCase() ===
      "true" ||
    telemetry.fuite === 1;

  const levelColor =
    getLevelColor(
      telemetry.niveau
    );

  /* =====================================================
     RENDER
  ===================================================== */

  return (
    <div className="app-shell">

      <header className="topbar">

        <div className="brand-area">

          <div className="brand-icon">
            💧
          </div>

          <div>
            <div className="brand">
              Réservoir Intelligent
            </div>

            <div className="device-label">
              Device :{" "}
              <strong>
                {telemetry.deviceId ||
                  DEVICE_ID_DEFAULT}
              </strong>
            </div>
          </div>

        </div>

        <div className="topbar-right">

          <ConnectionBadge
            label="Node-RED"
            connected={
              wsConnected
            }
          />

          <ConnectionBadge
            label="PostgreSQL API"
            connected={
              apiConnected
            }
          />

          <button
            className="logout-button"
            onClick={onLogout}
          >
            Déconnexion
          </button>

        </div>

      </header>

      <main className="dashboard">

        {fuiteActive && (
          <div className="critical-alert">

            <span className="critical-icon">
              ⚠
            </span>

            <div>
              <strong>
                FUITE DÉTECTÉE
              </strong>

              <span>
                Le système signale une fuite active.
              </span>
            </div>

          </div>
        )}

        {apiError && (
          <div className="system-alert error">
            <span>●</span>
            API : {apiError}
          </div>
        )}

        {/* =================================================
            LIVE
        ================================================= */}

        <div className="section-heading">

          <div>
            <h2>
              Supervision temps réel
            </h2>

            <p>
              Données reçues depuis Node-RED par WebSocket
            </p>
          </div>

          <span className="live-indicator">
            <i />
            LIVE
          </span>

        </div>

        <section className="live-grid">

          <div className="card tank-card">

            <div className="card-header">
              <span>
                RÉSERVOIR
              </span>

              <span className="live-small">
                ● LIVE
              </span>
            </div>

            <div className="tank-content">

              <div className="tank">

                <div
                  className="water"
                  style={{
                    height: `${
                      isFiniteNumber(
                        telemetry.niveau
                      )
                        ? clamp(
                            telemetry.niveau,
                            0,
                            100
                          )
                        : 0
                    }%`,

                    background:
                      levelColor,
                  }}
                />

                <div className="tank-mark mark-100">
                  100%
                </div>

                <div className="tank-mark mark-50">
                  50%
                </div>

                <div className="tank-mark mark-0">
                  0%
                </div>

              </div>

              <div
                className="tank-number"
                style={{
                  color:
                    levelColor,
                }}
              >
                {formatNumber(
                  telemetry.niveau,
                  0
                )}

                <span>%</span>
              </div>

            </div>

            <div className="last-update">
              Dernière donnée

              <strong>
                {formatDate(
                  telemetry.timestamp
                )}
              </strong>
            </div>

          </div>

          <MetricCard
            label="Distance HC-SR04"
            value={
              telemetry.distance
            }
            unit="cm"
            icon="↕"
          />

          <MetricCard
            label="Hauteur eau"
            value={
              telemetry.hauteur
            }
            unit="cm"
            icon="▥"
          />

          <MetricCard
            label="Volume"
            value={
              telemetry.volume
            }
            unit="L"
            icon="◈"
          />

          <MetricCard
            label="Temps remplissage"
            value={
              telemetry.temps
            }
            unit="s"
            icon="◷"
          />

          <MetricCard
            label="Puissance pompe"
            value={
              telemetry.puissance
            }
            unit="%"
            icon="⚡"
          />

          <MetricCard
            label="Débit"
            value={
              telemetry.debit
            }
            unit="cm/s"
            icon="≈"
          />

          <StatusCard
            label="Pompe"
            value={
              telemetry.pompe
            }
          />

          <StatusCard
            label="Relais"
            value={
              telemetry.relais
            }
          />

          <MetricCard
            label="Servo"
            value={
              telemetry.servo
            }
            unit="°"
            icon="◉"
          />

          <MetricCard
            label="Ouverture vanne"
            value={
              telemetry.vanne
            }
            unit="°"
            icon="◌"
          />

          <StatusCard
            label="Système"
            value={
              telemetry.systeme
            }
          />

          <StatusCard
            label="Fuite"
            value={
              telemetry.fuite
            }
            danger={
              fuiteActive
            }
          />

        </section>

        {/* =================================================
            COMMANDES
        ================================================= */}

        <section className="section-card">

          <SectionTitle
            title="Commandes"
            subtitle="Commandes envoyées vers l'ESP32 via MQTT"
          />

          {/* =================================================
              COMMANDES POMPE
          ================================================= */}

          <div className="commands-grid">

            <button
              className="command-button pump-on"
              onClick={() =>
                sendCommand(
                  "PUMP_ON"
                )
              }
            >
              <span className="command-icon">
                ▶
              </span>

              <span>
                <strong>
                  Démarrer pompe
                </strong>

                <small>
                  MQTT · PUMP_ON
                </small>
              </span>
            </button>

            <button
              className="command-button pump-off"
              onClick={() =>
                sendCommand(
                  "PUMP_OFF"
                )
              }
            >
              <span className="command-icon">
                ■
              </span>

              <span>
                <strong>
                  Arrêter pompe
                </strong>

                <small>
                  MQTT · PUMP_OFF
                </small>
              </span>
            </button>

            <button
              className="command-button reset"
              onClick={() =>
                sendCommand(
                  "RESET_FUITE"
                )
              }
            >
              <span className="command-icon">
                ↻
              </span>

              <span>
                <strong>
                  Reset fuite
                </strong>

                <small>
                  MQTT · RESET_FUITE
                </small>
              </span>
            </button>

          </div>

          {/* =================================================
              DEBIT
          ================================================= */}

          <div className="command-controls">

            <div className="command-control-card">

              <div className="control-header">
                <strong>
                  💧 Débit de la pompe
                </strong>

                <span>
                  SET_DEBIT
                </span>
              </div>

              <p>
                Choisir le débit autorisé par l'ESP32.
              </p>

              <select
                value={selectedDebit}
                onChange={(e) =>
                  setSelectedDebit(
                    Number(
                      e.target.value
                    )
                  )
                }
              >
                <option value={5}>
                  5
                </option>

                <option value={10}>
                  10
                </option>

                <option value={15}>
                  15
                </option>

                <option value={20}>
                  20
                </option>

                <option value={25}>
                  25
                </option>
              </select>

              <button
                className="primary-button"
                onClick={
                  handleSetDebit
                }
              >
                Appliquer débit
              </button>

            </div>

            {/* =================================================
                SEUILS
            ================================================= */}

            <div className="command-control-card">

              <div className="control-header">
                <strong>
                  🎚 Seuils de niveau
                </strong>

                <span>
                  SET_SEUILS
                </span>
              </div>

              <p>
                Les valeurs doivent respecter :
                0 ≤ bas &lt; haut ≤ 100.
              </p>

              <div className="input-row">

                <div>
                  <label>
                    Seuil bas (%)
                  </label>

                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={seuilBas}
                    onChange={(e) =>
                      setSeuilBas(
                        e.target.value
                      )
                    }
                  />
                </div>

                <div>
                  <label>
                    Seuil haut (%)
                  </label>

                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={seuilHaut}
                    onChange={(e) =>
                      setSeuilHaut(
                        e.target.value
                      )
                    }
                  />
                </div>

              </div>

              <div className="control-buttons">

                <button
                  className="primary-button"
                  onClick={
                    handleSetSeuils
                  }
                >
                  Appliquer seuils
                </button>

                <button
                  className="secondary-button"
                  onClick={
                    handleResetSeuils
                  }
                >
                  ↻ Seuils par défaut
                </button>

              </div>

            </div>

            {/* =================================================
                HC INITIAL
            ================================================= */}

            <div className="command-control-card">

              <div className="control-header">
                <strong>
                  📏 Distance HC initiale
                </strong>

                <span>
                  SET_HC_INITIAL
                </span>
              </div>

              <p>
                Valeur autorisée par l'ESP32 :
                100 à 400 cm.
              </p>

              <label>
                Distance initiale HC (cm)
              </label>

              <input
                type="number"
                min="100"
                max="400"
                step="1"
                value={hcInitial}
                onChange={(e) =>
                  setHcInitial(
                    e.target.value
                  )
                }
              />

              <button
                className="primary-button"
                onClick={
                  handleSetHcInitial
                }
              >
                Appliquer hauteur HC
              </button>

            </div>

          </div>

          {/* =================================================
              STATUT COMMANDE
          ================================================= */}

          {commandStatus && (
            <div className="command-status">
              {commandStatus}
            </div>
          )}

          {/* =================================================
              ACK
          ================================================= */}

          <div className="ack-panel">

            <div>
              <span>
                Dernier ACK
              </span>

              <strong>
                {latestAck?.status ||
                  "Aucun ACK"}
              </strong>
            </div>

            <div>
              <span>
                Command ID
              </span>

              <strong>
                {latestAck?.command_id ||
                  "—"}
              </strong>
            </div>

            <div>
              <span>
                Message
              </span>

              <strong>
                {latestAck?.message ||
                  "En attente"}
              </strong>
            </div>

            <div>
              <span>
                Heure
              </span>

              <strong>
                {latestAck
                  ? formatDate(
                      latestAck.acknowledged_at
                    )
                  : "—"}
              </strong>
            </div>

          </div>

        </section>

        {/* =================================================
            GRAPHIQUES
        ================================================= */}

        <section className="section-card">

          <SectionTitle
            title="Graphiques"
            subtitle="Historique provenant de PostgreSQL"
          />

          <div className="charts-grid">

            <ChartCard
              title="Niveau"
              data={chartData}
              dataKey="niveau"
              color="#22c1dc"
              unit="%"
            />

            <ChartCard
              title="Distance"
              data={chartData}
              dataKey="distance"
              color="#f59e0b"
              unit="cm"
            />

            <ChartCard
              title="Puissance pompe"
              data={chartData}
              dataKey="puissance"
              color="#22c55e"
              unit="%"
            />

            <ChartCard
              title="Débit"
              data={chartData}
              dataKey="debit"
              color="#a78bfa"
              unit="cm/s"
            />

          </div>

        </section>

        {/* =================================================
            POSTGRESQL
        ================================================= */}

        <section className="section-card history-card">

          <div className="history-header">

            <SectionTitle
              title="Historique PostgreSQL"
              subtitle="Données persistées dans reservoir_db"
            />

            <div className="export-buttons">

              <button
                className="secondary-button"
                onClick={
                  exportCurrentTable
                }
                disabled={
                  exportLoading
                }
              >
                📊 Cette table
              </button>

              <button
                className="primary-button"
                onClick={
                  exportAllData
                }
                disabled={
                  exportLoading
                }
              >
                📥 Tout exporter
              </button>

            </div>

          </div>

          <div className="tabs">

            {[
              [
                "measurements",
                "Mesures",
              ],

              [
                "states",
                "États",
              ],

              [
                "alerts",
                "Alertes",
              ],

              [
                "commands",
                "Commandes",
              ],

              [
                "acks",
                "ACK",
              ],
            ].map(
              ([key, label]) => (
                <button
                  key={key}
                  className={
                    activeTab === key
                      ? "tab active"
                      : "tab"
                  }
                  onClick={() =>
                    changeTab(key)
                  }
                >
                  {label}
                </button>
              )
            )}

          </div>

          <div className="table-tools">

            <div className="search-box">

              <span>⌕</span>

              <input
                value={search}
                onChange={(e) =>
                  setSearch(
                    e.target.value
                  )
                }
                placeholder="Rechercher dans PostgreSQL..."
              />

            </div>

            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(
                  Number(
                    e.target.value
                  )
                );

                setPage(1);
              }}
            >
              {HISTORY_PAGE_SIZES.map(
                (size) => (
                  <option
                    key={size}
                    value={size}
                  >
                    {size} lignes
                  </option>
                )
              )}
            </select>

          </div>

          {historyLoading && (
            <div className="loading">

              <span className="spinner" />

              Chargement PostgreSQL...

            </div>
          )}

          {historyError && (
            <div className="system-alert error">
              ❌ {historyError}
            </div>
          )}

          <HistoryTable
            rows={
              displayedHistory
            }
            activeTab={
              activeTab
            }
            onSort={
              handleSort
            }
            sortKey={
              sortKey
            }
            sortDirection={
              sortDirection
            }
          />

          <div className="pagination">

            <button
              className="page-button"
              disabled={
                page <= 1
              }
              onClick={() =>
                setPage(
                  (p) =>
                    Math.max(
                      1,
                      p - 1
                    )
                )
              }
            >
              ←
            </button>

            <div className="page-info">
              Page{" "}
              <strong>
                {pagination.page}
              </strong>{" "}
              sur{" "}
              <strong>
                {
                  pagination.totalPages
                }
              </strong>
            </div>

            <button
              className="page-button"
              disabled={
                page >=
                pagination.totalPages
              }
              onClick={() =>
                setPage(
                  (p) =>
                    Math.min(
                      pagination.totalPages,
                      p + 1
                    )
                )
              }
            >
              →
            </button>

            <span className="total-lines">
              {pagination.total} lignes
            </span>

          </div>

        </section>

        {/* =================================================
            ALERTES
        ================================================= */}

        <section className="section-card">

          <SectionTitle
            title="Alertes récentes"
            subtitle="Événements du système"
          />

          <div className="alerts-list">

            {alerts.length === 0 ? (
              <div className="empty">
                Aucune alerte récente.
              </div>
            ) : (
              alerts.map(
                (alert) => (
                  <div
                    key={alert.id}
                    className={`alert-row ${alert.type.toLowerCase()}`}
                  >
                    <div className="alert-type">
                      {alert.type}
                    </div>

                    <div className="alert-message">
                      {alert.message}
                    </div>

                    <div className="alert-time">
                      {formatDate(
                        alert.time
                      )}
                    </div>
                  </div>
                )
              )
            )}

          </div>

        </section>

      </main>
    </div>
  );
}

/* =========================================================
   COMPOSANTS
========================================================= */

function ConnectionBadge({
  label,
  connected,
}) {
  return (
    <div
      className={
        connected
          ? "connection connected"
          : "connection disconnected"
      }
    >
      <span className="connection-dot" />

      <span>
        {label}
      </span>

      <strong>
        {connected
          ? "CONNECTÉ"
          : "OFFLINE"}
      </strong>
    </div>
  );
}

function SectionTitle({
  title,
  subtitle,
}) {
  return (
    <div className="section-title">

      <h2>
        {title}
      </h2>

      {subtitle && (
        <p>
          {subtitle}
        </p>
      )}

    </div>
  );
}

function MetricCard({
  label,
  value,
  unit,
  icon,
}) {
  return (
    <div className="card metric-card">

      <div className="metric-top">

        <div className="metric-icon">
          {icon}
        </div>

      </div>

      <div className="metric-label">
        {label}
      </div>

      <div className="metric-value">

        {formatNumber(
          value,
          1
        )}

        <small>
          {unit}
        </small>

      </div>

    </div>
  );
}

function StatusCard({
  label,
  value,
  danger = false,
}) {
  const normalized =
    String(
      value ?? ""
    ).toLowerCase();

  let state = "—";
  let active = false;

  if (
    normalized === "true" ||
    normalized === "on" ||
    normalized === "active" ||
    normalized === "enabled" ||
    value === 1
  ) {
    state = "ACTIF";
    active = true;
  } else if (
    normalized === "false" ||
    normalized === "off" ||
    normalized === "inactive" ||
    normalized === "disabled" ||
    normalized === "none" ||
    value === 0
  ) {
    state = "INACTIF";
  } else if (
    value !== null &&
    value !== undefined &&
    String(value).trim()
  ) {
    state = String(value);
  }

  return (
    <div
      className={`card status-card ${
        danger
          ? "danger-card"
          : ""
      }`}
    >

      <div className="status-header">

        <span className="metric-label">
          {label}
        </span>

        <span
          className={`status-dot ${
            danger
              ? "danger"
              : active
              ? "active"
              : ""
          }`}
        />

      </div>

      <strong
        className={
          danger
            ? "status-danger"
            : active
            ? "status-active"
            : "status-value"
        }
      >
        {state}
      </strong>

    </div>
  );
}

function ChartCard({
  title,
  data,
  dataKey,
  color,
  unit,
}) {
  return (
    <div className="chart-card">

      <div className="chart-header">

        <h3>
          {title}
        </h3>

        <span>
          {unit}
        </span>

      </div>

      <ResponsiveContainer
        width="100%"
        height={260}
      >

        <LineChart
          data={data}
          margin={{
            top: 10,
            right: 15,
            left: -10,
            bottom: 5,
          }}
        >

          <CartesianGrid
            stroke="#193542"
            strokeDasharray="3 3"
          />

          <XAxis
            dataKey="time"
            stroke="#718b96"
            tick={{
              fontSize: 10,
            }}
          />

          <YAxis
            stroke="#718b96"
            tick={{
              fontSize: 10,
            }}
          />

          <Tooltip
            contentStyle={{
              background:
                "#0b202a",
              border:
                "1px solid #214654",
              borderRadius:
                "10px",
              color:
                "#eef9fb",
            }}
            formatter={(value) => [
              `${value} ${unit}`,
              title,
            ]}
          />

          <Legend />

          <Line
            type="monotone"
            dataKey={dataKey}
            name={title}
            stroke={color}
            strokeWidth={3}
            dot={false}
            activeDot={{
              r: 5,
            }}
            connectNulls
          />

        </LineChart>

      </ResponsiveContainer>

    </div>
  );
}

/* =========================================================
   TABLE
========================================================= */

function getTabLabel(tab) {
  const labels = {
    measurements: "Mesures",
    states: "États",
    alerts: "Alertes",
    commands: "Commandes",
    acks: "ACK",
  };

  return labels[tab] || tab;
}

function HistoryTable({
  rows,
  activeTab,
  onSort,
  sortKey,
  sortDirection,
}) {
  if (!rows.length) {
    return (
      <div className="empty">
        Aucune donnée dans cette table.
      </div>
    );
  }

  let columns = [];

  if (
    activeTab ===
    "measurements"
  ) {
    columns = [
      ["id", "ID"],
      ["device_id", "Device"],
      [
        "niveau_percent",
        "Niveau %",
      ],
      [
        "distance_cm",
        "Distance",
      ],
      [
        "hauteur_cm",
        "Hauteur",
      ],
      [
        "volume_liters",
        "Volume",
      ],
      [
        "fill_time_estimated_s",
        "Temps",
      ],
      [
        "puissance_pompe_percent",
        "Pompe %",
      ],
      [
        "debit_cm_s",
        "Débit",
      ],
      [
        "servo_angle_deg",
        "Servo",
      ],
      [
        "vanne_ouverture_deg",
        "Vanne",
      ],
      [
        "measured_at",
        "Date",
      ],
    ];
  }

  if (
    activeTab ===
    "states"
  ) {
    columns = [
      ["id", "ID"],
      ["device_id", "Device"],
      [
        "pompe_state",
        "Pompe",
      ],
      [
        "relais_state",
        "Relais",
      ],
      [
        "fuite_state",
        "Fuite",
      ],
      [
        "system_state",
        "Système",
      ],
      [
        "recorded_at",
        "Date",
      ],
    ];
  }

  if (
    activeTab ===
    "alerts"
  ) {
    columns = [
      ["id", "ID"],
      ["device_id", "Device"],
      [
        "alert_type",
        "Type",
      ],
      [
        "message",
        "Message",
      ],
      [
        "status",
        "Statut",
      ],
      [
        "level_percent",
        "Niveau",
      ],
      [
        "distance_cm",
        "Distance",
      ],
      [
        "created_at",
        "Date",
      ],
    ];
  }

  if (
    activeTab ===
    "commands"
  ) {
    columns = [
      ["id", "ID"],
      [
        "command_id",
        "Command ID",
      ],
      [
        "device_id",
        "Device",
      ],
      [
        "command_type",
        "Commande",
      ],
      [
        "command_value",
        "Valeur",
      ],
      [
        "topic",
        "Topic",
      ],
      [
        "source",
        "Source",
      ],
      [
        "created_at",
        "Date",
      ],
    ];
  }

  if (
    activeTab ===
    "acks"
  ) {
    columns = [
      ["id", "ID"],
      [
        "command_id",
        "Command ID",
      ],
      [
        "device_id",
        "Device",
      ],
      [
        "status",
        "Statut",
      ],
      [
        "message",
        "Message",
      ],
      [
        "acknowledged_at",
        "Date",
      ],
    ];
  }

  return (
    <div className="table-wrapper">

      <table>

        <thead>

          <tr>

            {columns.map(
              ([key, label]) => (
                <th
                  key={key}
                  onClick={() =>
                    onSort(key)
                  }
                >

                  <span>
                    {label}
                  </span>

                  {sortKey ===
                    key && (
                    <b>
                      {sortDirection ===
                      "asc"
                        ? " ↑"
                        : " ↓"}
                    </b>
                  )}

                </th>
              )
            )}

          </tr>

        </thead>

        <tbody>

          {rows.map(
            (row, index) => (
              <tr
                key={
                  row.id ??
                  index
                }
              >

                {columns.map(
                  ([key]) => {
                    const value =
                      row[key];

                    let display =
                      value;

                    if (
                      key.endsWith(
                        "_at"
                      ) ||
                      key ===
                        "measured_at" ||
                      key ===
                        "created_at"
                    ) {
                      display =
                        formatDate(
                          value
                        );
                    }

                    if (
                      value !==
                        null &&
                      value !==
                        undefined &&
                      (
                        typeof value ===
                          "number" ||
                        (
                          typeof value ===
                            "string" &&
                          /^-?\d+(\.\d+)?$/.test(
                            value
                          )
                        )
                      )
                    ) {
                      if (
                        key.includes(
                          "percent"
                        ) ||
                        key.includes(
                          "cm"
                        ) ||
                        key.includes(
                          "liters"
                        ) ||
                        key.includes(
                          "estimated"
                        )
                      ) {
                        display =
                          Number(
                            value
                          ).toFixed(
                            2
                          );
                      }
                    }

                    return (
                      <td
                        key={key}
                      >
                        {display ??
                          "—"}
                      </td>
                    );
                  }
                )}

              </tr>
            )
          )}

        </tbody>

      </table>

    </div>
  );
}
