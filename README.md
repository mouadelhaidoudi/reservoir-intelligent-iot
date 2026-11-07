# Reservoir Intelligent IoT

Local stack assembled from the supplied Node-RED flow, PostgreSQL schema,
Grafana dashboard, React/Express application, and Wokwi ESP32 circuit.

## Start

1. Start Docker Desktop.
2. Run `docker compose up --build -d` from this directory.
3. Open:
   - React: http://localhost:5173
   - API health: http://localhost:3001/api/health
   - Node-RED editor: http://localhost:1880
   - Node-RED dashboard: http://localhost:1880/ui
   - Grafana: http://localhost:3000 (`admin` / `admin1234`)
   - InfluxDB: http://localhost:8086 (`admin` / `admin1234`)

The stack is named `reservoir-iot`, so it uses its own containers, network,
and named volumes.

## Wokwi circuit

Open `src/wokwi` in VS Code with PlatformIO and the Wokwi extension. Build the
PlatformIO project, then run **Wokwi: Start Simulator**. The circuit talks to
the public HiveMQ broker, as do Node-RED and the API, because a Wokwi cloud
simulation cannot connect to a Docker-only `localhost` MQTT broker.

The local Mosquitto service remains available on ports 1883 and 9001 for local
clients and future offline-device work.

## Reset all persisted data

`docker compose down -v` removes this project's database and service volumes.
